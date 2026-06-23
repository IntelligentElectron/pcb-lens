import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ErrorResult,
  QueryNetResult,
  NetRouteInfo,
  RoutingArc,
  RoutingSegment,
  ViaCount,
  ViaDrill,
  ViaRow,
  QueryNetsResult,
} from "./lib/types.js";
import { attr, numAttr, streamAllLines } from "./lib/xml-utils.js";
import {
  addPin,
  buildLineDescDict,
  capDetailRows,
  capRowsStratified,
  MAX_COORD_ROWS,
  MAX_PIN_ROWS,
  extractMicronFactor,
  formatResult,
  groupPinsByRefdes,
  makeAccumulator,
  validateFile,
  validatePattern,
  type Detail,
  type NetAccumulator,
} from "./shared.js";
import { withTelemetry } from "../telemetry/index.js";

export const queryNet = async (
  filePath: string,
  pattern: string,
  detail: Detail = "summary"
): Promise<QueryNetsResult | ErrorResult> => {
  const err = await validateFile(filePath);
  if (err) return err;

  const validation = validatePattern(pattern);
  if ("error" in validation) return validation;
  const { regex } = validation;

  const factor = await extractMicronFactor(filePath);

  // Pass 1: Discover matching nets from LogicalNet + PhyNet sections,
  // extract pins from LogicalNet, extract layers from PhyNetPoint.
  const accumulators = new Map<string, NetAccumulator>();
  const phyNetNames = new Set<string>();
  const matchedPhyNetNames = new Set<string>();
  let insideMatchedLogicalNet = false;
  let insideMatchedPhyNet = false;
  let currentLogicalNetName = "";
  let currentPhyNetName = "";

  await streamAllLines(filePath, (line) => {
    // Stop once we reach LayerFeature (Pass 3 handles that)
    if (line.includes("<LayerFeature")) return false;

    // LogicalNet pin extraction
    if (line.includes("<LogicalNet ")) {
      const name = attr(line, "name");
      if (name && regex.test(name)) {
        insideMatchedLogicalNet = true;
        currentLogicalNetName = name;
        if (!accumulators.has(name)) accumulators.set(name, makeAccumulator());
      } else {
        insideMatchedLogicalNet = false;
      }
    }

    if (insideMatchedLogicalNet) {
      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          addPin(accumulators.get(currentLogicalNetName)!, compRef, pin);
        }
      }
      if (line.includes("</LogicalNet>")) {
        insideMatchedLogicalNet = false;
      }
    }

    // PhyNet layer extraction
    if (line.includes("<PhyNet ")) {
      const name = attr(line, "name");
      if (name) {
        phyNetNames.add(name);
      }
      if (name && regex.test(name)) {
        insideMatchedPhyNet = true;
        currentPhyNetName = name;
        matchedPhyNetNames.add(name);
        if (!accumulators.has(name)) accumulators.set(name, makeAccumulator());
      } else {
        insideMatchedPhyNet = false;
      }
    }

    if (insideMatchedPhyNet) {
      if (line.includes("<PhyNetPoint ")) {
        const layerRef = attr(line, "layerRef");
        if (layerRef) {
          accumulators.get(currentPhyNetName)!.phyNetLayers.add(layerRef);
        }
      }
      if (line.includes("</PhyNet>")) {
        insideMatchedPhyNet = false;
      }
    }
  });

  // If no nets matched, return empty matches (not an error)
  if (accumulators.size === 0) {
    return { pattern, units: "MICRON", matches: [] };
  }

  if (phyNetNames.size > 0 && matchedPhyNetNames.size === phyNetNames.size) {
    return {
      error: `Pattern '${pattern}' matches all ${phyNetNames.size} physical nets. Use a more specific pattern, or use get_pcb_metadata for net counts and discovery.`,
    };
  }

  // Pass 2: Build LineDesc dictionary
  const lineDescDict = await buildLineDescDict(filePath);

  // Pass 3: LayerFeature routing/vias for all matched nets
  const matchedNames = new Set(accumulators.keys());
  const skipLayers = new Set(["REF-route", "REF-both"]);

  // Per-trace centerline geometry is only collected when the caller opts into
  // detail="full"; in summary mode this stays false so Pass 3 does no extra work.
  const wantSegments = detail === "full";

  let currentLayerName = "";
  let insideMatchedSet = false;
  let currentSetNetName = "";
  let currentSetHasConductor = false;
  let currentSetLineDescId: string | undefined;
  let currentSetInlineWidth: number | undefined;
  let inPad = false;
  let inPolyline = false;
  let polyPoints: { x: number; y: number }[] = [];
  let polyLength = 0;

  // Per-trace geometry collected for detail="full". `setSegments` holds the
  // current <Set>'s traces; `ownWidthRaw` is the trace's OWN width descriptor
  // (raw, pre-factor) captured from a <LineDescRef>/<LineDesc> child of that
  // primitive. Traces without one fall back to the set/feature-level width at
  // </Set>. `primRefId`/`primInlineWidth` accumulate the current primitive's own
  // descriptor; `pendingLine`/`inLine` carry a <Line> across physical lines.
  let segPoints: [number, number][] = [];
  let segArcs: RoutingArc[] = [];
  let primRefId: string | undefined;
  let primInlineWidth: number | undefined;
  let inLine = false;
  let pendingLine: { layer: string; pts: [number, number][] } | null = null;
  // Every conductor width (microns) seen in the current <Set>, so the per-layer
  // rollup reports ALL distinct widths a Set uses (e.g. two <Line>s of different
  // width), not just the last descriptor. Collected in summary mode too.
  let setConductorWidths: number[] = [];
  let setSegments: {
    layer: string;
    points: [number, number][];
    arcs: RoutingArc[];
    ownWidthRaw?: number;
  }[] = [];

  // Capture the current primitive's OWN width descriptor. A child <LineDesc
  // lineWidth> is the most specific; otherwise a child <LineDescRef> id is
  // resolved against the LineDesc dictionary at finalize time.
  const captureOwnDesc = (l: string): void => {
    if (l.includes("<LineDescRef ")) {
      const id = attr(l, "id");
      if (id) primRefId = id;
    }
    if (l.includes("<LineDesc ") && !l.includes("<EntryLineDesc ")) {
      const w = numAttr(l, "lineWidth");
      if (w !== undefined) primInlineWidth = w;
    }
  };
  const ownWidthRaw = (): number | undefined => {
    if (primInlineWidth !== undefined) return primInlineWidth;
    if (primRefId !== undefined) return lineDescDict.get(primRefId);
    return undefined;
  };
  const flushPendingLine = (): void => {
    if (pendingLine) {
      setSegments.push({
        layer: pendingLine.layer,
        points: pendingLine.pts,
        arcs: [],
        ownWidthRaw: ownWidthRaw(),
      });
      pendingLine = null;
    }
    inLine = false;
  };

  await streamAllLines(filePath, (line) => {
    if (line.includes("<LayerFeature ")) {
      currentLayerName = attr(line, "layerRef") ?? "";
    }

    if (line.includes("<Set ")) {
      const netName = attr(line, "net");
      insideMatchedSet = Boolean(
        netName && matchedNames.has(netName) && !skipLayers.has(currentLayerName)
      );
      currentSetNetName = netName ?? "";
      currentSetHasConductor = false;
      currentSetLineDescId = undefined;
      currentSetInlineWidth = undefined;
      inPad = false;
      inPolyline = false;
      polyLength = 0;
      setSegments = [];
      setConductorWidths = [];
      pendingLine = null;
      inLine = false;
      primRefId = undefined;
      primInlineWidth = undefined;
    }

    if (insideMatchedSet) {
      const acc = accumulators.get(currentSetNetName)!;

      // Track pad context so custom pad outlines (which also use <Polygon>) are
      // not miscounted as routing copper below. Guard against self-closing
      // `<Pad ... />`, which has no children and no `</Pad>` to reset the flag.
      if (line.includes("<Pad ") && !line.includes("/>")) inPad = true;
      if (line.includes("</Pad>")) inPad = false;

      if (line.includes("<PinRef ")) {
        const compRef = attr(line, "componentRef");
        const pin = attr(line, "pin");
        if (compRef && pin) {
          addPin(acc, compRef, pin);
        }
      }

      if (line.includes("<Polyline")) {
        currentSetHasConductor = true;
        inPolyline = true;
        polyPoints = [];
        segPoints = [];
        segArcs = [];
        if (wantSegments) {
          flushPendingLine(); // finalize a preceding self-closing <Line/>
          primRefId = undefined;
          primInlineWidth = undefined;
        }
      }

      if (inPolyline) {
        if (line.includes("<PolyBegin ") || line.includes("<PolyStepSegment ")) {
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          if (x !== undefined && y !== undefined) {
            const pt = { x: x * factor, y: y * factor };
            if (polyPoints.length > 0) {
              const prev = polyPoints[polyPoints.length - 1];
              const dx = pt.x - prev.x;
              const dy = pt.y - prev.y;
              polyLength += Math.sqrt(dx * dx + dy * dy);
            }
            polyPoints.push(pt);
            if (wantSegments) segPoints.push([Math.round(pt.x), Math.round(pt.y)]);
          }
        }

        // Curved vertices (<PolyStepCurve>) are only captured for the detail=
        // "full" geometry export; summary length math (polyLength) deliberately
        // ignores them, preserving the existing summary output unchanged.
        if (wantSegments && line.includes("<PolyStepCurve ")) {
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          const cx = numAttr(line, "centerX");
          const cy = numAttr(line, "centerY");
          if (x !== undefined && y !== undefined && cx !== undefined && cy !== undefined) {
            segPoints.push([Math.round(x * factor), Math.round(y * factor)]);
            segArcs.push({
              index: segPoints.length - 1,
              centerX: Math.round(cx * factor),
              centerY: Math.round(cy * factor),
              clockwise: attr(line, "clockwise") === "true",
            });
          }
        }

        // The polyline's own width descriptor (child <LineDescRef>/<LineDesc>).
        if (wantSegments) captureOwnDesc(line);

        if (line.includes("</Polyline>")) {
          if (wantSegments && segPoints.length >= 2) {
            setSegments.push({
              layer: currentLayerName,
              points: segPoints,
              arcs: segArcs,
              ownWidthRaw: ownWidthRaw(),
            });
          }
          inPolyline = false;
        }
      }

      // Conductor segments encoded as <Line startX startY endX endY> rather than
      // a <Polyline>. Cadence uses these for single-segment traces; a net routed
      // entirely with <Line> elements previously returned no routing at all.
      // Only conductor layers reach here (skipLayers excludes REF-route/REF-both),
      // and a Line is only counted when it carries start/end coordinates.
      if (line.includes("<Line ")) {
        const sx = numAttr(line, "startX");
        const sy = numAttr(line, "startY");
        const ex = numAttr(line, "endX");
        const ey = numAttr(line, "endY");
        if (sx !== undefined && sy !== undefined && ex !== undefined && ey !== undefined) {
          currentSetHasConductor = true;
          const dx = (ex - sx) * factor;
          const dy = (ey - sy) * factor;
          polyLength += Math.sqrt(dx * dx + dy * dy);
          if (wantSegments) {
            // Begin a pending <Line> trace; its OWN width comes from a child
            // <LineDescRef>/<LineDesc> (so two <Line>s in one <Set> keep their
            // distinct widths). flush any prior unfinished line first.
            flushPendingLine();
            primRefId = undefined;
            primInlineWidth = undefined;
            pendingLine = {
              layer: currentLayerName,
              pts: [
                [Math.round(sx * factor), Math.round(sy * factor)],
                [Math.round(ex * factor), Math.round(ey * factor)],
              ],
            };
            // Capture a same-line child descriptor, then finalize if the <Line>
            // is closed (</Line>) or self-closed (/>) on this physical line.
            captureOwnDesc(line);
            if (line.includes("</Line>") || line.includes("/>")) flushPendingLine();
            else inLine = true;
          }
        }
      }

      // Continuation for a <Line> whose descriptor / close span multiple physical
      // lines (the opening <Line ...> line is handled above).
      if (wantSegments && inLine && !line.includes("<Line ")) {
        captureOwnDesc(line);
        if (line.includes("</Line>")) flushPendingLine();
      }

      // Poured copper: nets are frequently filled as <Contour> shapes (a polygon
      // outline, optionally with a <FillDescRef>) rather than centerline
      // <Polyline>/<Line> conductors. Modern Cadence/Allegro pours even short signal
      // traces and all planes this way, so such nets previously reported empty routing
      // despite being fully routed. Count the shape as routing presence on the layer
      // so the net is reported routed; a filled shape has no centerline width or
      // length, so we record only the layer + a segment and leave
      // traceWidths/traceLength empty. We key off <Contour> specifically (the filled-
      // region wrapper) rather than a bare <Polygon>, since polygons also appear as
      // board outlines and custom pad shapes. We deliberately do NOT require a
      // <FillDescRef>: real pours do not always carry one (e.g. testcase5 GNDEARTH),
      // and missing a real pour (reporting a routed net as unrouted) is worse for this
      // tool than occasionally counting a rare outline-only contour. The inPad guard
      // additionally keeps any pad-level contour out of the routing count.
      if (!inPad && (line.includes("<Contour>") || line.includes("<Contour "))) {
        currentSetHasConductor = true;
      }

      if (line.includes("<LineDescRef ")) {
        const id = attr(line, "id");
        currentSetLineDescId = id;
        // Record this conductor's width for the rollup. inPad guards against a
        // (rare) pad-level reference; the </Set> guard discards widths from any
        // Set that turns out to carry no conductor geometry.
        if (!inPad && id !== undefined) {
          const w = lineDescDict.get(id);
          if (w !== undefined) setConductorWidths.push(Math.round(w * factor));
        }
      }

      if (line.includes("<LineDesc ") && !line.includes("<EntryLineDesc ")) {
        const inlineWidth = numAttr(line, "lineWidth");
        if (inlineWidth !== undefined) {
          currentSetInlineWidth = inlineWidth;
          if (!inPad) setConductorWidths.push(Math.round(inlineWidth * factor));
        }
      }

      if (line.includes("<Hole ")) {
        const platingStatus = attr(line, "platingStatus");
        if (platingStatus === "VIA") {
          const x = numAttr(line, "x");
          const y = numAttr(line, "y");
          const diameter = numAttr(line, "diameter") ?? 0;
          if (x !== undefined && y !== undefined) {
            acc.vias.push({
              x: Math.round(x * factor),
              y: Math.round(y * factor),
              diameter: Math.round(diameter * factor),
              layer: currentLayerName,
            });
          }
        }
      }

      if (line.includes("</Set>")) {
        if (wantSegments) flushPendingLine(); // finalize a trailing self-closing <Line/>

        if (currentSetHasConductor && currentLayerName) {
          if (!acc.routeMap.has(currentLayerName)) {
            acc.routeMap.set(currentLayerName, { widths: new Set(), segments: 0, traceLength: 0 });
          }
          const layerRoute = acc.routeMap.get(currentLayerName)!;
          layerRoute.segments++;
          layerRoute.traceLength += polyLength;

          // Add every distinct conductor width the Set used (a Set may carry
          // several primitives of differing width); the widths Set dedupes.
          for (const w of setConductorWidths) layerRoute.widths.add(w);
        }

        // Flush this Set's per-trace geometry (detail="full"). Each trace reports
        // its OWN width when it carries one; only a trace with no descriptor of
        // its own falls back to a set/feature-level <LineDescRef>/inline width
        // (some tools attach one shared descriptor to a Set of bare features).
        // 0 when nothing resolves.
        if (wantSegments && setSegments.length > 0) {
          let setWidth = 0;
          if (currentSetLineDescId) {
            const w = lineDescDict.get(currentSetLineDescId);
            if (w !== undefined) setWidth = Math.round(w * factor);
          } else if (currentSetInlineWidth !== undefined) {
            setWidth = Math.round(currentSetInlineWidth * factor);
          }
          for (const s of setSegments) {
            const width =
              s.ownWidthRaw !== undefined ? Math.round(s.ownWidthRaw * factor) : setWidth;
            const seg: RoutingSegment = { layer: s.layer, width, points: s.points };
            if (s.arcs.length > 0) seg.arcs = s.arcs;
            acc.segments.push(seg);
          }
        }

        insideMatchedSet = false;
      }
    }
  });

  // Assemble results
  const matches = [...accumulators.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([netName, acc]) => {
      const routing: NetRouteInfo[] = [];
      for (const [layerName, data] of [...acc.routeMap.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        routing.push({
          layerName,
          traceWidths: [...data.widths].sort((a, b) => a - b),
          segmentCount: data.segments,
          traceLength: Math.round(data.traceLength),
        });
      }

      const drillList: ViaDrill[] = [];
      const drillIdx = new Map<string, number>();
      const drillCounts: number[] = [];
      const viaRows: ViaRow[] = [];
      for (const v of acc.vias) {
        const key = `${v.diameter}:${v.layer}`;
        let idx = drillIdx.get(key);
        if (idx === undefined) {
          idx = drillList.length;
          drillList.push({ diameter: v.diameter, layer: v.layer });
          drillCounts.push(0);
          drillIdx.set(key, idx);
        }
        drillCounts[idx]++;
        viaRows.push([v.x, v.y, idx]);
      }
      const viaCounts: ViaCount[] = drillList.map((d, i) => ({
        diameter: d.diameter,
        layer: d.layer,
        count: drillCounts[i],
      }));

      const totalSegments = routing.reduce((sum, r) => sum + r.segmentCount, 0);
      const totalVias = viaRows.length;
      const totalTraceLength = Math.round(routing.reduce((sum, r) => sum + r.traceLength, 0));

      // Merge PhyNetPoint layers with routing-derived layers
      const layerSet = new Set(acc.phyNetLayers);
      for (const r of routing) layerSet.add(r.layerName);
      const layersUsed = [...layerSet].sort();

      // Connected pins. The grouped map is the core connectivity payload, but it
      // grows without bound on huge-fanout nets (power/ground). Cap the flat pin
      // list before grouping so we never allocate or return more than the budget,
      // while pinCount still reports the true total.
      const pinCount = acc.pins.length;
      const cappedPins = capDetailRows(acc.pins, MAX_PIN_ROWS);
      const pins = groupPinsByRefdes(cappedPins.rows);

      const result: QueryNetResult = {
        netName,
        pinCount,
        pins,
        layersUsed,
      };
      if (cappedPins.truncated) result.truncated = true;

      if (routing.length > 0) {
        result.routing = routing;
      }
      if (viaCounts.length > 0) {
        // Compact rollup is returned by default; raw per-via coordinates are
        // included only when the caller opts into detail="full" (capped).
        result.viaCounts = viaCounts;
        if (detail === "full") {
          // Stratify across drill spans (row's drillIndex) so the sample is
          // proportionally representative rather than biased toward whichever
          // span appears first in the file.
          const capped = capRowsStratified(viaRows, MAX_COORD_ROWS, (row) => row[2]);
          result.viaColumns = ["x", "y", "drillIndex"];
          result.viaRows = capped.rows;
          if (capped.truncated) result.truncated = true;
        }
      }
      if (detail === "full" && acc.segments.length > 0) {
        // Per-trace centerline geometry, stratified by layer so a truncated
        // sample still represents every routed layer. The per-layer rollup
        // (routing[].segmentCount) carries the true Set-level totals.
        const cappedSegs = capRowsStratified(acc.segments, MAX_COORD_ROWS, (s) => s.layer);
        result.segments = cappedSegs.rows;
        if (cappedSegs.truncated) result.truncated = true;
      }
      if (totalSegments > 0) {
        result.totalSegments = totalSegments;
      }
      if (totalVias > 0) {
        result.totalVias = totalVias;
      }
      if (totalTraceLength > 0) {
        result.totalTraceLength = totalTraceLength;
      }

      return result;
    });

  return { pattern, units: "MICRON", matches };
};

export const register = (server: McpServer): void => {
  server.registerTool(
    "get_pcb_net",
    {
      description:
        "Query nets by name pattern in an IPC-2581 file. Returns grouped connected pins, per-layer routing, and a compact via rollup (count per drill type). Routing is read from conductor-layer copper geometry in the export (Polyline/Line centerline traces and poured Contour shapes); trace widths and lengths are reported for centerline-routed copper and are absent for shape/plane-routed (poured) copper, which has no centerline. If the IPC-2581 export was generated without conductor/etch (cline) feature output, the file carries no conductor geometry and routing is empty even though pins, vias, and layersUsed still populate. Pass detail='full' for raw per-via coordinates and per-trace centerline geometry (each Polyline/Line as vertices + width + arcs), both capped. Poured shapes have no centerline and are absent from the per-trace geometry; segments[].length is per-primitive and does not equal totalSegments (Set-level). Rejects patterns that match all nets.",
      inputSchema: {
        file: z.string().describe("Path to IPC-2581 XML file"),
        pattern: z
          .string()
          .describe("Regex pattern for net name (e.g., '^DDR_D0$', 'CLK', '^VCC_3V3$')"),
        detail: z
          .enum(["summary", "full"])
          .default("summary")
          .describe(
            "Response detail. 'summary' (default) returns via counts and the per-layer routing rollup only. 'full' (must be set explicitly) additionally returns raw per-via x/y coordinates and per-trace centerline geometry (segments[]: vertices, width, arcs), both capped to stay within the response budget."
          ),
      },
    },
    withTelemetry("get_pcb_net", async ({ file, pattern, detail }) => {
      const result = await queryNet(file, pattern, detail);
      return formatResult(result);
    })
  );
};

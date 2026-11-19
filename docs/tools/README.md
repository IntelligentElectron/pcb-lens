# Tools

| Tool | Description |
|------|-------------|
| [`get_pcb_metadata`](get_pcb_metadata.md) | Get an overview of an IPC-2581 file: metadata, layer stackup, component/net counts, and section sizes |
| [`get_pcb_component`](get_pcb_component.md) | Look up a single component by exact refdes with placement, BOM, net, and pad data |
| [`get_pcb_net`](get_pcb_net.md) | Query a net by name pattern for pin connections, routing per layer, and via info |
| [`get_pcb_footprint`](get_pcb_footprint.md) | Look up footprint and padstack definitions of an Allegro `.brd` by name: pins, drill, plating, pads, antipads and thermals per layer, masks |
| [`get_pcb_layer`](get_pcb_layer.md) | List the lines, shapes and text drawn on the layers of an Allegro `.brd` (silkscreen, assembly, place bounds, keepouts, copper shapes) |
| [`get_constraints`](get_constraints.md) | Read layout constraints from a Cadence `.tcfx`, `.dcf` or Allegro `.brd` file |
| [`export_cadence_ipc2581`](export_cadence_ipc2581.md) | Export a Cadence Allegro `.brd` file to IPC-2581 XML (Windows only) |
| [`export_cadence_constraints`](export_cadence_constraints.md) | Export a Cadence Allegro `.brd` file to `.tcfx` constraint XML (Windows only) |

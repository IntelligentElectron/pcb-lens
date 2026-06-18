# Observability (OpenTelemetry)

The PCB Lens MCP Server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, so you can see which tools are used, how long they take, and what fails. It is vendor-neutral and speaks OTLP, so it works with any OTLP-compatible backend — an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/), Jaeger, Tempo, Prometheus, Honeycomb, Datadog, a managed cloud tracing service, and so on.

This is the full developer reference and integration guide. For a one-paragraph summary, see the [root README](../README.md#observability-opentelemetry).

## Design guarantees

- **Disabled by default, zero overhead.** If no OTLP endpoint is configured, the SDK is never imported and instrumentation is a pure pass-through. Enabling telemetry requires no code changes — only standard `OTEL_*` environment variables.
- **Telemetry never breaks a tool call.** Every span, metric, and log operation is wrapped so that an exporter fault, misconfiguration, or unreachable backend degrades to "no telemetry" — it never surfaces an error to the caller or changes a tool result.
- **stdout is reserved for MCP.** The server speaks JSON-RPC over stdio, so stdout carries the MCP protocol. All telemetry diagnostics go to **stderr only**, and no console/stdout exporter is ever used.
- **Flushed on shutdown.** Batched, asynchronous exports are flushed when the process exits (including `SIGINT`/`SIGTERM`), so short-lived invocations do not lose data.

## Signals reference

Each tool call produces one span, updates three metric instruments, and emits one log record. All three signals are correlated and carry the shared resource attributes below.

### Traces

A span named `tool/<tool_name>` (for example, `tool/get_pcb_metadata`) is created for each invocation, with these attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `tool.name` | string | The tool that was invoked, e.g. `get_pcb_net`. |
| `tool.outcome` | string | `success` or `error`. |
| `tool.duration_ms` | number | Wall-clock duration of the tool call in milliseconds. |
| `error.type` | string | Present only on failure. The error name (e.g. `Error`), or `tool_error` when the tool returned a structured error result. |
| `tool.args` | string | JSON-serialized tool arguments. **Only recorded when `OTEL_CAPTURE_TOOL_ARGS=1`** (off by default; arguments may be sensitive). |

The span status is set to `ERROR` on failure (and the exception is recorded), `OK` otherwise.

### Metrics

| Instrument | Type | Unit | Labels | Description |
|------------|------|------|--------|-------------|
| `tool.calls` | counter | — | `tool`, `outcome` | Number of tool invocations. |
| `tool.duration` | histogram | `ms` | `tool`, `outcome` | Tool invocation duration. |
| `tool.errors` | counter | — | `tool`, `error_type` | Number of failed tool invocations. |

Metrics are exported periodically (default every 60s — see `OTEL_METRIC_EXPORT_INTERVAL`) and flushed on shutdown.

### Logs

A structured log record is emitted per tool call:

| Field | Value |
|-------|-------|
| Body | `tool/<tool_name> <outcome>`, e.g. `tool/get_pcb_net success`. |
| Severity | `INFO` on success, `ERROR` on failure. |
| Attributes | `tool.name`, `tool.outcome`, `tool.duration_ms`, `error.type` (on failure), plus `trace_id` and `span_id`. |

The explicit `trace_id` / `span_id` attributes (in addition to the record's own trace context) make trace-to-log correlation straightforward in any backend.

### Resource attributes

These apply to every span, metric, and log record:

| Attribute | Value |
|-----------|-------|
| `service.name` | `OTEL_SERVICE_NAME` if set, otherwise `pcb-lens`. |
| `service.version` | The running server version. |
| `enduser.id` | The host OS account name of whoever is running the server. This attributes usage to the per-session user without any configuration. (Omitted if the username cannot be read.) |

Add your own resource attributes with `OTEL_RESOURCE_ATTRIBUTES` (see below).

## Configuration

Telemetry is configured **purely through the standard OpenTelemetry environment variables** — there is no bespoke config file or API. Setting any OTLP endpoint turns it on.

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for all signals. **Setting this (or any per-signal endpoint below) enables telemetry.** |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Per-signal endpoint override for traces. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Per-signal endpoint override for metrics. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Per-signal endpoint override for logs. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers sent with every export, e.g. `Authorization=Bearer <token>` for a managed backend. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json`. `grpc` is **not** bundled in the standalone binaries and falls back to `http/protobuf` with a warning on stderr. |
| `OTEL_SERVICE_NAME` | Service identity in the `service.name` resource attribute. Defaults to `pcb-lens`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource attributes, e.g. `deployment.environment=prod,team=hw`. |
| `OTEL_TRACES_SAMPLER` | Standard OTel trace sampler selection. |
| `OTEL_BSP_SCHEDULE_DELAY` | Batch span processor export interval (ms). |
| `OTEL_BLRP_SCHEDULE_DELAY` | Batch log record processor export interval (ms). |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric export interval in ms (default `60000`). |
| `OTEL_SDK_DISABLED` | Set to `true`/`1` to force telemetry off even if an endpoint is configured. |

Application-specific option:

| Variable | Purpose |
|----------|---------|
| `OTEL_CAPTURE_TOOL_ARGS` | Set to `1`/`true` to also record raw tool arguments as the `tool.args` span attribute. Off by default — arguments (file paths, net names) may be sensitive. |

> **Protocol note:** Because the server ships as a standalone compiled binary, only the HTTP OTLP exporters are bundled. Use `http/protobuf` (the default, port `4318` on most collectors) or `http/json`. If you point at a gRPC-only endpoint (`4317`), switch the backend to accept OTLP/HTTP instead.

## Integration guides

### Local Collector / Jaeger quick start

Run an all-in-one Jaeger (which accepts OTLP and renders traces) and point the server at it:

```bash
docker run --rm -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=pcb-lens
# then start the MCP server as usual; open http://localhost:16686 to view traces
```

Invoke a tool through your AI client, then look for `tool/<tool_name>` spans under the `pcb-lens` service in the Jaeger UI.

### Managed / cloud backend

Most hosted backends accept OTLP/HTTP with an auth header. Point at their ingest endpoint and pass credentials via `OTEL_EXPORTER_OTLP_HEADERS`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example-vendor.com
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${VENDOR_API_KEY}"
export OTEL_SERVICE_NAME=pcb-lens
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod
```

Multiple headers are comma-separated (`key1=value1,key2=value2`). Check your vendor's docs for the exact endpoint and header names (some use `api-key=...` rather than `Authorization`).

### Setting the env vars per MCP client

The server normally runs as a subprocess of your AI client, so set the `OTEL_*` variables in that client's MCP server config rather than your shell. For example, in a Claude Desktop / Claude Code style `mcpServers` entry:

```json
{
  "mcpServers": {
    "pcb-lens": {
      "command": "pcb-lens",
      "env": {
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
        "OTEL_SERVICE_NAME": "pcb-lens"
      }
    }
  }
}
```

Any of the variables in the [Configuration](#configuration) table can be supplied this way.

## Verifying it works

1. With an endpoint configured, call any tool from your AI client.
2. Confirm spans appear in your backend (e.g. the Jaeger UI at `http://localhost:16686`, service `pcb-lens`, operation `tool/<tool_name>`).
3. Check `tool.calls` / `tool.duration` metrics and the correlated log records.

If nothing arrives, the server itself keeps working — telemetry failures are silent on the hot path. Look at the server's **stderr** for `[otel]` diagnostic lines (e.g. an init failure or a gRPC fallback warning), and double-check the endpoint, protocol (`http/protobuf` vs `http/json`), and port (`4318` for OTLP/HTTP).

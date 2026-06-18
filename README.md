# PCB Lens MCP Server

The **PCB Lens MCP Server** gives AI agents the tools to query and review your PCB layouts, enabling physical design review through natural conversations.

It works with any board layout in IPC-2581 format, exported from any EDA tool that supports the standard.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| IPC-2581 | `.xml` / `.cvg` | IPC-2581 XML files (RevA, RevB, RevC) from any compliant EDA tool |

## Native Install (Recommended)

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/pcb-lens/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/pcb-lens/main/install.ps1 | iex
```

Why use the native installer:
- **No dependencies** — standalone binary, no Node.js required
- **Auto-updates** — checks for updates on startup
- **Signed binaries** — macOS binaries are notarized by Apple

The installer downloads two files:

1. **Binary** - For CLI usage and manual MCP client configuration
2. **Claude Desktop extension** (.mcpb) - For easy Claude Desktop integration

| Platform | Install Directory |
|----------|-------------------|
| macOS | `~/Library/Application Support/pcb-lens/` |
| Linux | `~/.local/share/pcb-lens/` |
| Windows | `%LOCALAPPDATA%\pcb-lens\` |

### Update

The server checks for updates on startup. To update manually:

```bash
pcb-lens --update
```

## Alternative: Install via npm

For developers who prefer npm:

```bash
npm install -g @intelligentelectron/pcb-lens
```

Or use with npx (no installation required):

```bash
npx @intelligentelectron/pcb-lens --help
```

Requires Node.js 20+.

To update:

```bash
npm update -g @intelligentelectron/pcb-lens
```

## Connect the MCP with your favorite AI tool

After installing the MCP with one of the methods above, you can connect it to your AI agent of choice.

### Claude Desktop

1. Download the [Claude Desktop app](https://claude.ai/download)
2. Open Claude Desktop and go to **Settings** (gear icon)
3. Under **Desktop app**, click **Extensions**
4. Click **Advanced settings**
5. In the **Extension Developer** section, click **Install Extension...**
6. Navigate to your install directory and select `pcb-lens.mcpb`:
   - **macOS**: `~/Library/Application Support/pcb-lens/pcb-lens.mcpb`
   - **Windows**: `%LOCALAPPDATA%\pcb-lens\pcb-lens.mcpb`

The extension will be available immediately in your conversations.

### Claude Code

Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code), then run:

```bash
claude mcp add --scope user pcb-lens -- pcb-lens
```

### OpenAI Codex

Install [OpenAI Codex](https://developers.openai.com/codex/cli/), then run:

```bash
codex mcp add pcb-lens -- pcb-lens
```

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `pcb-lens-darwin-universal` |
| Linux (x64) | `pcb-lens-linux-x64` |
| Linux (ARM64) | `pcb-lens-linux-arm64` |
| Windows (x64) | `pcb-lens-windows-x64.exe` |

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call — a span, the `tool.calls`/`tool.duration`/`tool.errors` metrics, and a correlated log record — so you can see which tools are used, how long they take, and what fails. It is vendor-neutral and speaks OTLP, working with any compatible backend (OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, a managed cloud service, etc.).

**Disabled by default**, with zero overhead. Turn it on purely with the standard `OTEL_*` environment variables — point `OTEL_EXPORTER_OTLP_ENDPOINT` at your backend (and optionally set `OTEL_SERVICE_NAME`); no code changes. Telemetry never affects tool results.

See **[docs/observability.md](docs/observability.md)** for the full signal reference, configuration, and integration guide.

## Documentation

See [docs/](docs/README.md) for API documentation and response schemas.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## About

Created by **Valentino Zegna**

This project is hosted on GitHub under the [IntelligentElectron](https://github.com/IntelligentElectron) organization.

## License

Apache License 2.0 - see [LICENSE](LICENSE)

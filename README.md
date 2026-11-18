# PCB Lens MCP Server

The **PCB Lens MCP Server** gives AI agents the tools to understand and review your PCB layouts, for physical design reviews through natural conversations.

It reads IPC-2581 layouts from any EDA tool, and Cadence Allegro boards and constraint files directly on macOS, Linux, and Windows, with no Cadence installation and no EDA license required.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence Allegro | `.brd` | Reads the binary board directly. Layout (Allegro 16.x, 17.x and 18.x): copper layers, board outline, component placement and pads, net connectivity, routing (tracks and arcs), vias and copper shapes. Constraints (Allegro 17.x): the live physical and electrical constraint sets, net classes, match groups, diff pairs, regions, per-net assignments and the stackup, plus the Constraint Manager archives the board embeds. See [the Allegro .brd format](docs/allegro-brd-format.md) |
| Cadence Constraint Manager | `.dcf` | Constraint database of a schematic or board |
| Cadence TCFX | `.tcfx` | Constraint XML exported from Allegro: physical and spacing rules, net classes, stackup, regions |
| IPC-2581 | `.xml` | RevA, RevB and RevC files from any compliant EDA tool: stackup, board outline, component placement and pads, net connectivity, routing and vias |

## Install

Installing takes two steps: the `pcb-lens` binary, then the plugin for your agent. The plugin connects the MCP server to the agent, so there is no configuration to write.

### 1. Install the binary

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/pcb-lens/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/pcb-lens/main/install.ps1 | iex
```

The installer provides:
- **No dependencies**: a standalone binary, with no Node.js required
- **Auto-updates**: the binary checks for updates on startup; `pcb-lens update` updates it on demand
- **Signed binaries**: macOS binaries are notarized by Apple

It places the binary in the `bin/` folder of `~/Library/Application Support/pcb-lens/` (macOS), `~/.local/share/pcb-lens/` (Linux) or `%LOCALAPPDATA%\pcb-lens\` (Windows), and adds that folder to your PATH in both your shell's startup file and its login profile, so apps started outside a terminal, such as the Claude desktop app, find it too. Restart your agent afterwards.

<details>
<summary>Install with npm instead</summary>

```bash
npm install -g @intelligentelectron/pcb-lens
```

Requires Node.js 24+. Update with `npm update -g @intelligentelectron/pcb-lens`.

Install the binary one way only: the plugin runs the first `pcb-lens` on your PATH.

</details>

### 2. Install the plugin

#### Claude Code

```
/plugin marketplace add IntelligentElectron/pcb-lens
/plugin install pcb-lens@pcb-lens
```

Local sessions in the Code tab of the [Claude desktop app](https://claude.ai/download) use Claude Code's plugins, so the server is available there too.

#### OpenAI Codex

```bash
codex plugin marketplace add IntelligentElectron/pcb-lens --sparse .agents/plugins --sparse plugins
codex plugin add pcb-lens@pcb-lens
```

The `--sparse` paths fetch only the plugin; Codex otherwise clones the whole repository, test fixtures included. The plugin works in the Codex CLI and the Codex app.

Then ask the agent to review a layout, trace a net, or read a board's constraints.

#### Other agents

<details>
<summary>Cursor</summary>

Open **Customize**, choose **Browse Marketplace**, then **Add Marketplace → Import from GitHub**. Enter `IntelligentElectron/pcb-lens` and add the `pcb-lens` plugin.

</details>

<details>
<summary>GitHub Copilot CLI</summary>

```bash
copilot plugin marketplace add IntelligentElectron/pcb-lens
copilot plugin install pcb-lens@pcb-lens
```

</details>

<details>
<summary>Turn the plugin on for everyone who clones a project</summary>

Add this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "pcb-lens": {
      "source": { "source": "github", "repo": "IntelligentElectron/pcb-lens" }
    }
  },
  "enabledPlugins": { "pcb-lens@pcb-lens": true }
}
```

and this to the project's `.codex/config.toml`:

```toml
[marketplaces.pcb-lens]
source_type = "git"
source = "https://github.com/IntelligentElectron/pcb-lens.git"
sparse_paths = [".agents/plugins", "plugins"]

[plugins."pcb-lens@pcb-lens"]
enabled = true
```

Each person still installs the binary once.

</details>

<details>
<summary>Moving from a server you registered by hand</summary>

If you registered the server yourself before, remove that registration so the agent does not run two copies:

```bash
claude mcp remove --scope user pcb-lens
```

```bash
codex mcp remove pcb-lens
```

</details>

<details>
<summary>The command line, for agents without MCP</summary>

Every MCP tool is also a shell command, for an agent in a sandbox or container that cannot connect an MCP server:

```bash
pcb-lens get_pcb_net board.xml --pattern '^DDR_D'
pcb-lens get_constraints board.brd --section BrdStackup
```

The plugin carries a skill that teaches an agent those commands, their flags and exit codes; the agent uses it only when the MCP server is not connected. Agents that read [Agent Skills](https://agentskills.io) can install the skill alone through the GitHub CLI:

```bash
gh skill install IntelligentElectron/pcb-lens pcb-lens --agent github-copilot --scope user
```

See [docs/cli.md](docs/cli.md) for the command line itself.

</details>

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, which report what is used, how long it takes, and what fails. Any OTLP-compatible backend receives them (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, or a managed cloud tracing service).

OpenTelemetry is **disabled by default** and is enabled and configured through the standard `OTEL_*` environment variables, with no code changes.

See **[Observability (OpenTelemetry)](docs/observability.md)** for setup, configuration, and the full list of emitted spans, metrics, and logs.

## Documentation

See [docs/](docs/README.md) for API documentation, response schemas and [supported platforms](docs/README.md#supported-platforms), [docs/cli.md](docs/cli.md) for the binary's command line, and [docs/allegro-brd-format.md](docs/allegro-brd-format.md) for the Allegro board format as pcb-lens reads it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Privacy Policy

The server runs on your machine and sends the author nothing. It keeps a local usage log (`telemetry.jsonl`) in its install directory, which leaves the machine only if you pack it with `pcb-lens export-telemetry` and share it. Its only network call is the update check against this repository's GitHub releases.

## About

This project is hosted on GitHub under the [IntelligentElectron](https://github.com/IntelligentElectron) organization.

PCB Lens MCP Server is an original work by [Valentino Zegna](https://www.linkedin.com/in/valentinozegna).

## Acknowledgments

The Allegro `.brd` reader's file header, string table and block framing follow the notes of KiCad's Allegro importer ([FORMAT.md](https://github.com/KiCad/kicad-source-mirror/blob/master/pcbnew/pcb_io/allegro/FORMAT.md)). Their work made reading the board database directly possible.

## License

Apache License 2.0 - see [LICENSE](LICENSE)

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

### Gemini CLI

Install [Gemini CLI](https://geminicli.com/docs/get-started/installation/), then run:

```bash
gemini mcp add --scope user pcb-lens pcb-lens
```

### VS Code (GitHub Copilot)

Download [VS Code](https://code.visualstudio.com/)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "pcb-lens": {
      "type": "stdio",
      "command": "pcb-lens"
    }
  }
}
```

Then enable it in **Configure Tools** (click the tools icon in Copilot chat).

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `pcb-lens-darwin-universal` |
| Linux (x64) | `pcb-lens-linux-x64` |
| Linux (ARM64) | `pcb-lens-linux-arm64` |
| Windows (x64) | `pcb-lens-windows-x64.exe` |

## Documentation

See [docs/](docs/README.md) for API documentation and response schemas.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## About

Created by **Valentino Zegna**

This project is hosted on GitHub under the [IntelligentElectron](https://github.com/IntelligentElectron) organization.

## License

Apache License 2.0 - see [LICENSE](LICENSE)

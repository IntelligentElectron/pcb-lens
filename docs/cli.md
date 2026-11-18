# Command Line

The `pcb-lens` binary is an MCP server: an MCP client runs it with no command and speaks to it over stdio. Run by hand with no command, it prints how to set that up instead of serving. Everything else it can do is a command, and every MCP tool is one too. Every command is accepted as a word (`pcb-lens update`) and as a flag (`pcb-lens --update`).

```
Usage: pcb-lens [options] [command]

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  <tool> [file] --flag value ...
                       Run an MCP tool and print its JSON result
```

## Query tools

```bash
pcb-lens <tool> [file] --flag value ...
pcb-lens <tool> --help
```

Every MCP tool is a command under its own name: `get_pcb_metadata`, `get_pcb_component`, `get_pcb_net`, `get_constraints`, `export_cadence_ipc2581` and `export_cadence_constraints` (`pcb-lens --help` lists them). Each call is stateless: it names the file, and prints one result.

The flags are the tool's arguments, built from the same schema the MCP server registers, so the names, defaults and checks are the same:

| Argument kind | Written as |
|---------------|------------|
| text | `--pattern CLK` or `--pattern=CLK`. A value starting with a dash needs `=`: `--pattern=-12V` |
| choice | `--detail full`; a value outside the choices is a usage error |
| the file | `--file board.xml` (`--board board.brd` on the export tools), or the first argument: `pcb-lens get_pcb_net board.xml --pattern CLK` |

The result is the tool's JSON on stdout: indented on a terminal, one compact line otherwise.

| Exit | Meaning |
|------|---------|
| 0 | The result answers the query |
| 1 | The result has an `error` field: a missing file, no match, an invalid pattern |
| 2 | Usage error: an unknown or missing flag, or a value of the wrong kind. The message and the tool's usage line go to stderr |

A tool's name as the first word always runs that tool, so a pattern or a value may be any word, `help` included.

## Agent skill

`plugins/pcb-lens/skills/pcb-lens/SKILL.md` teaches an agent this command line. It is generated from the tool registry (`src/tools/index.ts`) by `npm run gen:skill`, and a test fails while the committed file differs from the registry, so run it after changing a tool's description or arguments.

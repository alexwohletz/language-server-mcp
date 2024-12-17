# language-server-mcp MCP Server

A Model Context Protocol (MCP) server providing language support for code editing.

This is a TypeScript-based MCP server designed to enhance code editing experiences by providing features such as hover information, code completion, and diagnostics. It demonstrates core MCP concepts by providing:

- Language-specific tools for code analysis and manipulation
- Integration with the Model Context Protocol for seamless communication

## Features

### Language Support
- Provides hover information for symbols in code
- Offers code completion suggestions
- Reports diagnostic information (errors, warnings)
- Only tested with typescript, theoretically should support Python. Would love to add additional language servers or be more agnostic if possible.

### MCP Integration
- Implements the MCP protocol for communication with clients
- Exposes language features as MCP tools

### Tools
- `get_hover`: Get hover information for a position in a document
  - Takes languageId, filePath, content, line, and character as required parameters
- `get_completions`: Get completion suggestions for a position in a document
  - Takes languageId, filePath, content, line, and character as required parameters
- `get_diagnostics`: Get diagnostic information for a document
  - Takes languageId, filePath, and content as required parameters

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "language-server-mcp": {
      "command": "/path/to/language-server-mcp/build/index.js"
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

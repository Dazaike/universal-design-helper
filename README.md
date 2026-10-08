# Universal Design Helper

A Chrome extension overlay for capturing, annotating, and handing off web UI design change requests directly to coding agents or developers.

## Features

- **Draggable Overlay Toolbar**: Quick access to drawing tools, element inspector, image attachments, and change request inputs without disrupting host webpage layout.
- **Draw Annotations**: Freehand stroke drawing over visible elements.
- **Select Element Mode**: Inspect and extract DOM hierarchy, CSS selector paths, and computed style context.
- **Image Attachments**: Drag-and-drop, paste from clipboard (`Ctrl+V`), or file upload.
- **Handoff Export**: Composites full canvas annotations, element metadata, attachments, and change descriptions formatted for coding agents.
- **Page Isolation**: Shadow DOM encapsulated styles with event scoping to prevent focus stealing or triggering host webpage shortcuts.

## Development

```bash
# Install dependencies
npm install

# Build extension into dist/
npm run build

# Run TypeScript checks
npm run typecheck

# Run test suite
npm test
```

## Loading Extension

1. Navigate to `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the project's `dist/` directory.

## MCP Server (Alt+Click Handoff)

The extension can hand off a selected element directly to a coding agent via [MCP](https://modelcontextprotocol.io), bypassing the download/clipboard flow. Enable **Alt+Click + MCP** in the toolbar, then Alt+Click any element to send its context straight to the `get_pending_design_request` tool.

This requires the bundled bridge server (`mcp-server/dist/index.js`) to be reachable on `127.0.0.1:7420`. An MCP client (e.g. OMP, configured with `command: node`, `args: ["<repo>/mcp-server/dist/index.js"]`) spawns this automatically while connected. To run it standalone - e.g. after a reboot, without an agent session active - create a shortcut:

```bash
npm run build          # produces mcp-server/dist/index.js
npm run mcp:shortcut   # creates "Design Helper MCP Server.lnk" in your Downloads folder
npm run mcp:autostart  # installs the same shortcut into the Windows Startup folder
```

`mcp:shortcut` is for manual double-click launch. `mcp:autostart` makes the bridge start automatically on every login, independent of whether OMP (or any other MCP client) is running - useful since OMP only spawns the server while it's actively connected, not at boot.


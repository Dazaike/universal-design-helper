# Changelog

## [v0.2.0] - 2026-10-08

No commits since v0.1.1; entries below are from the uncommitted working-tree changes released here.

### Added
- MCP bridge: Alt+Click handoff of a selected element to a coding agent via a bundled MCP server (`src/mcp-server`, built to `mcp-server/dist/index.js`) listening on `127.0.0.1:7420`; background worker posts handoffs to it.
- `npm run mcp:start`, `mcp:shortcut`, `mcp:autostart` scripts and `scripts/create-mcp-shortcut.ps1`.
- "Enable Alt+Click + MCP" toggle in the overlay toolbar; multi-element selection.
- Tiled capture (`planCaptureTiles`) so annotations spanning more than one viewport are stitched into one image; clear error when the area exceeds the canvas limit.
- README section documenting the MCP server.

### Changed
- Crop box and element rects now use page-space coordinates instead of viewport-only.
- Visible-tab capture uses JPEG (quality 95) instead of PNG.
- Handoff text accepts multiple element contexts.
- Manifest adds `http://127.0.0.1/*` host permission.
- Build also bundles the MCP server; `mcp-server/dist/` is git-ignored.

### Fixed
- Annotations were clipped to the visible viewport; they now cover the full selected span.

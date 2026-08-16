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

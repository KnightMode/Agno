# NG Obsidian (Electron + macOS)

A modern Obsidian-style desktop app for macOS built with Electron + React.

## Implemented core features

- Vault picker and persisted active vault session.
- Recursive file explorer for folders and markdown notes.
- Markdown editing with CodeMirror.
- Live markdown preview.
- Wiki links (`[[Note]]`) detection.
- Backlinks panel.
- Vault-wide search and quick switcher (`Cmd/Ctrl+P`).
- Knowledge graph modal built from wiki links.
- Native terminal pane using `node-pty` + `xterm`.
- Auto-refresh via file watcher.

## Stack

- Electron (main/preload)
- React + Vite (renderer)
- CodeMirror (editor)
- Marked + DOMPurify (preview)
- xterm + node-pty (terminal)

## Run locally

```bash
npm install
npm run dev
```

## Build macOS package

```bash
npm run build
```

## Keyboard shortcuts

- `Cmd/Ctrl+S`: Save current note
- `Cmd/Ctrl+P`: Open quick switcher
- `Cmd/Ctrl+O`: Open vault picker

## Notes

- `node-pty` is a native module; ensure Xcode command line tools are installed on macOS.
- The graph currently uses a radial layout for speed and clarity.

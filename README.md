<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Agno icon">
</p>

<h1 align="center">Agno</h1>

<p align="center">
  A local-first knowledge base and note-taking app for macOS.<br>
  Markdown files, wiki links, a built-in terminal, and GitHub sync — no cloud account required.
</p>

---

Agno stores everything as plain markdown files in a folder (a "vault") on your machine. You own your notes. Back them up however you like, or sync to GitHub directly from the app.

## Features

**Editor** — Click any block of text to edit it inline. Markdown is rendered live with syntax highlighting for 14+ languages. No mode switching, no separate preview pane.

**Wiki Links** — Link notes with `[[Note Name]]` syntax. A backlinks panel shows what links to the current note, and an outgoing links panel shows what it links to.

**Knowledge Graph** — Interactive force-directed graph of your vault built from wiki links. Pin nodes, collapse branches, and navigate visually.

**Find** — Vault-wide fuzzy search (`Cmd+K` / `Cmd+P`) across titles, paths, and content. In-note find (`Cmd+F`) with match highlighting and prev/next navigation.

**Split View** — Open a second note side-by-side for reference while editing.

**Terminal** — Native terminal pane (`Cmd+`\``) powered by xterm.js and node-pty. Runs your default shell inside the app, positionable at the bottom or right.

**Version History** — Browse and restore previous versions of any note. Visual diff view shows exactly what changed.

**GitHub Sync** — Initialize a git repo in your vault, create or link a GitHub repository, and sync with one click. Uses personal access tokens — no OAuth flow.

**Customization** — Three themes (dark, light, warm), seven accent colors, 13 font families, adjustable font size, line height, and content width.

**Tabs** — Multi-tab interface with pinning, context menus, and split-from-tab support.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New note |
| `Cmd+S` | Save |
| `Cmd+O` | Open vault |
| `Cmd+K` / `Cmd+P` | Command palette / quick switcher |
| `Cmd+F` | Find in note |
| `Cmd+,` | Settings |
| `Cmd+\` | Toggle sidebar |
| `Cmd+`` ` `` | Toggle terminal |
| `Cmd+Enter` / `Esc` | Commit inline edit |

## Run Locally

Requires Node.js and Xcode command line tools (for the native `node-pty` module).

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Produces a `.dmg` and `.zip` in the `dist/` folder.

## Stack

- Electron + React 19 + Vite
- Marked + DOMPurify (markdown rendering)
- highlight.js (code syntax highlighting)
- Fuse.js (fuzzy search)
- xterm.js + node-pty (terminal)
- ForceGraph2D (knowledge graph)
- Radix UI + Tailwind CSS (UI components)

## License

MIT

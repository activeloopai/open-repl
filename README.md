# OpenREPL

> Open-source, self-hosted AI coding workspace — chat on the left, a live **Canvas**
> (files · editor · terminal · preview) on the right. Bring your own model.
> Runs locally with one command.

## Quickstart

```bash
npm install        # once
npm start          # builds the web UI, starts the server, opens the browser
```

Then chat: try **"create a file hello.js"** and watch it appear in the editor.

Run on a specific folder / port, without auto-opening the browser:

```bash
npm start -- /path/to/project --port=4317 --no-open
# or directly:
npx tsx packages/cli/src/index.ts /path/to/project --no-open
```

## What it does

- **Canvas** — file tree + CodeMirror editor live-synced with the filesystem, a real
  terminal (PTY), a preview pane that proxies your dev server, and model/usage/secrets panels.
- **Multi-agent** — an Orchestrator delegates to Planner / Coder / Reviewer roles, each with
  its own tools and model tier. The Coder runs the app and fixes it until it actually starts
  (run → observe → fix loop).
- **Bring your own model**:
  - **Claude** — runs the agent layer on Anthropic's Claude Agent SDK; cheap roles on Haiku,
    hard roles on Opus/Sonnet.
  - **OpenRouter** — any of 600+ models with one API key; reports real $ cost.
- **Persistent memory** — conversation history per workspace.
- **Cost/usage dashboard** — per-provider/model spend with CSV/JSON export.
- **Secrets** — `.env` manager (chmod 600), injected into commands/terminal/preview.

Everything stays **local**: config and memory live in `./.openrepl` inside the workspace.

## Layout

```
packages/
  shared/   WebSocket protocol types (single source of truth)
  server/   http + ws, workspace FS, agent loop, providers, usage, memory, secrets
  web/      React + CodeMirror + xterm + recharts UI
  cli/      `openrepl` launcher
```

## Tests

```bash
npm test                     # unit/integration tests (vitest)
npx tsx scripts/smoke.ts     # end-to-end: boots the server, drives it over WS
```

## Configuration

Set provider credentials in a workspace `.env` (managed via the Secrets panel), e.g.
`ANTHROPIC_API_KEY` for the Claude engine or `OPENROUTER_API_KEY` for OpenRouter.
A real `.env` is git-ignored; commit only `.env.example`.

## License

License TBD — add a `LICENSE` file before public release.

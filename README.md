# Claw Diary

> A dashcam for your AI assistant. Auto-records all agent activity, generates daily narrative summaries, visual timeline replay, and cost analytics.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## What It Does

Claw Diary runs silently in the background via hooks, capturing every tool call your AI agent makes. It then transforms that raw activity data into:

- **Daily Diary** — Narrative markdown summaries with session breakdowns, tool usage, and insights
- **Visual Timeline** — Interactive HTML page with search, filtering, animated replay, and cost curves
- **Cost Analytics** — 30-day trends, per-model breakdown, pattern discovery, failure rate tracking
- **Export** — Markdown, HTML, and JSON formats for archiving or sharing

Zero external API calls. Zero additional cost. Everything runs locally.

## Quick Start

```bash
# Install & build
npm install && npm run build

# Try it out (generates timeline from existing data, if any)
npm run timeline
npm run analytics
```

### Hook Configuration

Add to your OpenClaw / Claude Code settings to enable automatic collection:

```json
{
  "hooks": {
    "beforeToolCall": "node /path/to/claw-diary/dist/scripts/collector.js before",
    "afterToolCall": "node /path/to/claw-diary/dist/scripts/collector.js after",
    "sessionStart": "node /path/to/claw-diary/dist/scripts/collector.js session-start",
    "sessionStop": "node /path/to/claw-diary/dist/scripts/collector.js session-stop"
  }
}
```

Replace `/path/to/claw-diary` with the actual install path.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/diary` | Today's diary summary (markdown) |
| `/diary:replay` | Launch interactive HTML timeline in browser |
| `/diary:stats` | Cost & activity analytics (30-day window) |
| `/diary:week` | Weekly summary report |
| `/diary:search <query>` | Search historical events |
| `/diary:export [md\|html\|json]` | Export diary data |
| `/diary:clear --yes` | Delete all data (requires `--yes` flag) |

## Configuration

Create `~/.claw-diary/config.json` to customize recording behavior:

```json
{
  "recordingLevel": "full"
}
```

| Level | Behavior |
|-------|----------|
| `full` | Record everything including tool args and result previews (default) |
| `summary` | Skip tool arguments and output previews — lighter storage |
| `minimal` | Only record session start/end — lowest footprint |

## Architecture

```
Hook events (stdin)
       |
  collector.ts  -->  ~/.claw-diary/events/YYYY-MM-DD.jsonl
       |
       +---> summarizer.ts  -->  Daily/weekly markdown narratives
       +---> timeline.ts    -->  Interactive HTML timeline
       +---> analytics.ts   -->  Cost stats, patterns, export
       +---> server.ts      -->  Local HTTP server (timeline + reports)
```

All data stored as daily JSONL files under `~/.claw-diary/events/`. No database required.

### Key Design Decisions

- **Template-based summaries** — No LLM calls for narrative generation. Zero additional cost.
- **Privacy-first** — Automatic redaction of API keys, tokens, passwords, secrets. No network requests.
- **File-based storage** — Simple, portable, grep-able. One file per day.
- **Self-contained HTML** — Timeline output is a single HTML file with inline CSS/JS. No CDN dependencies.

## Supported Models (Cost Tracking)

| Model | Input $/M | Output $/M |
|-------|-----------|------------|
| Claude Opus 4.6 | $15.00 | $75.00 |
| Claude Sonnet 4.5 | $3.00 | $15.00 |
| Claude Haiku 4.5 | $0.80 | $4.00 |
| GPT-4o | $2.50 | $10.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| o1 | $15.00 | $60.00 |
| o3-mini | $1.10 | $4.40 |

Unknown models fall back to $3/$15 per million tokens.

## Privacy & Security

- All data stored locally at `~/.claw-diary/` — nothing leaves your machine
- **No external network requests** — no Google Fonts, no CDN, no analytics
- Automatic sanitization of API keys (`sk-*`), GitHub tokens (`ghp_*`), Slack tokens (`xoxb-*`), private keys, passwords, and 15+ sensitive environment variable patterns
- Configurable recording levels to minimize data capture
- One-command data deletion (`/diary:clear --yes`)

## Development

```bash
npm run build      # Compile TypeScript
npm test           # Run tests (Node.js built-in test runner)
npm run server     # Start visualization server at http://127.0.0.1:3847
```

### Project Structure

```
scripts/
  types.ts        # Core types, pricing table, shared utilities
  collector.ts    # Hook-based event capture (stdin -> JSONL)
  summarizer.ts   # Daily & weekly narrative generation
  timeline.ts     # Interactive HTML timeline generator
  analytics.ts    # Stats, patterns, search, export
  server.ts       # Local HTTP server for visualization
tests/
  test-types.ts   # Unit tests for core utilities
  test-smoke.ts   # Integration smoke tests
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Run `npm run build && npm test` to verify
5. Commit and push
6. Open a pull request

## License

[MIT](LICENSE)

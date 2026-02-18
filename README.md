# Claw Diary

> A dashcam for your AI assistant. Auto-records all agent activity, generates daily narrative summaries, visual timeline replay, and cost analytics.

[![npm](https://img.shields.io/npm/v/claw-diary.svg)](https://www.npmjs.com/package/claw-diary)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## What It Does

Claw Diary runs silently in the background via hooks, capturing every tool call your AI agent makes. It then transforms that raw activity data into:

- **Daily Diary** — Narrative markdown summaries with session breakdowns, tool usage, and insights
- **Visual Timeline** — Interactive HTML page with search, filtering, animated replay, and cost curves
- **Cost Analytics** — 30-day trends, per-model breakdown, pattern discovery, failure rate tracking
- **AI Journal** — First-person diary entries written by the AI with evolving personality and continuity across days
- **Export** — Markdown, HTML, and JSON formats for archiving or sharing

Zero external API calls. Zero additional cost. Everything runs locally.

## Quick Start

```bash
npm install -g claw-diary
```

### Install as Claude Code Skill

**Option A** — From ClaWHub:
```bash
clawhub install claw-diary
```

**Option B** — Manual:
```bash
mkdir -p ~/.claude/skills/claw-diary
cp "$(npm root -g)/claw-diary/SKILL.md" ~/.claude/skills/claw-diary/SKILL.md
```

### Hook Configuration (Claude Code)

Add the following to your `~/.claude/settings.json` to enable automatic activity collection:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claw-diary collect before"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claw-diary collect after"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claw-diary collect session-start"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claw-diary collect session-stop"
          }
        ]
      }
    ]
  }
}
```

### Try It Out

```bash
# Generate timeline from existing data (if any)
claw-diary timeline
claw-diary stats
```

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
| `/diary:thoughts` | AI personal journal entry (first-person) |
| `/diary:persona` | View/edit AI persona |

## CLI

After installing globally, the `claw-diary` command is available:

```bash
claw-diary summarize              # Today's diary summary
claw-diary summarize week         # Weekly summary
claw-diary summarize date 2026-02-18  # Specific date
claw-diary stats                  # Cost & activity analytics
claw-diary search "refactor"      # Search historical events
claw-diary export md              # Export as markdown (or html, json)
claw-diary replay                 # Launch visual timeline in browser
claw-diary timeline               # Generate timeline HTML file
claw-diary clear --yes            # Delete all data
claw-diary collect before         # Hook: pre-tool-use event
```

## Configuration

Create `~/.claw-diary/config.json` to customize recording behavior:

```json
{
  "recordingLevel": "summary"
}
```

| Level | Behavior |
|-------|----------|
| `full` | Record everything including tool args and result previews |
| `summary` | Skip tool arguments and output previews (default) |
| `minimal` | Only record session start/end — lowest footprint |

## Architecture

```
claw-diary <command>        (unified CLI entry point)
       |
       +---> collect         Hook events (stdin) --> ~/.claw-diary/events/YYYY-MM-DD.jsonl
       +---> summarize       Daily/weekly markdown narratives
       +---> timeline        Interactive HTML timeline generator
       +---> stats/search    Cost analytics, patterns, export
       +---> replay          Local HTTP server (timeline + reports)
```

All data stored as daily JSONL files under `~/.claw-diary/events/`. No database required.

### Key Design Decisions

- **Template-based summaries** — No LLM calls for narrative generation. Zero additional cost.
- **Privacy-first** — Automatic redaction of API keys, tokens, passwords, secrets. No network requests.
- **File-based storage** — Simple, portable, grep-able. One file per day.
- **Self-contained HTML** — Timeline output is a single HTML file with inline CSS/JS. No CDN dependencies.

## Cost Tracking

Claw Diary tracks token costs using a three-tier priority:

1. **Platform-provided cost** — If the hook data includes an `estimatedCost` value (calculated by the platform), that value is used directly.
2. **Custom pricing** — You can define per-model pricing in `~/.claw-diary/config.json` (see below). This takes priority over built-in defaults.
3. **Built-in fallback** — A bundled pricing table covers common Claude and OpenAI models. Unknown models fall back to $3/$15 per million tokens (input/output).

### Custom Model Pricing

Add a `customPricing` field to `~/.claw-diary/config.json` to override or add model prices (per 1M tokens):

```json
{
  "recordingLevel": "full",
  "customPricing": {
    "gemini-2.0-flash": { "input": 0.10, "output": 0.40 },
    "my-fine-tuned-model": { "input": 5.0, "output": 20.0 }
  }
}
```

This lets you track costs for any model — including fine-tuned, self-hosted, or third-party models not in the built-in table.

## Privacy & Security

- All data stored locally at `~/.claw-diary/` — nothing leaves your machine
- **No external network requests** — no Google Fonts, no CDN, no analytics
- Automatic sanitization of API keys (`sk-*`), GitHub tokens (`ghp_*`), Slack tokens (`xoxb-*`), private keys, passwords, and 15+ sensitive environment variable patterns
- Configurable recording levels to minimize data capture
- One-command data deletion (`/diary:clear --yes`)

## Development

```bash
git clone https://github.com/0xbeekeeper/claw-diary.git
cd claw-diary
npm install && npm run build   # Compile TypeScript
npm test                       # Run tests (Node.js built-in test runner)
npm link                       # Link for local development
```

### Project Structure

```
scripts/
  cli.ts          # Unified CLI entry point (claw-diary <command>)
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

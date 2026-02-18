---
name: claw-diary
description: "Personal AI agent visual diary. Auto-records all agent activity, generates daily narrative summaries, and provides visual timeline replay. Use /diary to view today's summary, /diary:replay to launch visual timeline, /diary:stats for cost and pattern analytics."
metadata: {"clawdbot":{"emoji":"📔","requires":{"bins":["node"]},"files":["scripts/*"]}}
homepage: https://github.com/0xbeekeeper/claw-diary
version: "1.0.0"
---

# Claw Diary — Personal Agent Visual Diary

An always-on agent activity recorder that auto-tracks every action, generates daily narrative summaries, and supports visual timeline replay. Like a dashcam for your AI assistant.

## Setup

Configure hooks in your OpenClaw settings to enable automatic activity collection:

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

Data is stored locally at `~/.claw-diary/events/` as daily JSONL files. No data leaves your machine.

## Slash Commands

### `/diary` — Today's Summary
Generate and display today's agent diary summary. Shows sessions, key activities, token usage, and cost breakdown in a narrative format.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/summarizer.js today` and display the markdown output.

### `/diary:replay` — Visual Timeline
Launch an interactive HTML timeline in the browser showing all agent activities with color-coded nodes, token cost visualization, and click-to-expand details.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/server.js` to start a local server, then open the URL in the browser.

### `/diary:stats` — Cost & Activity Stats
Show cost analysis (daily, weekly, by model, by tool), activity metrics (sessions, tool calls, failure rate), and discovered patterns.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/analytics.js stats` and display the output.

### `/diary:week` — Weekly Report
Generate a weekly summary aggregating all daily diaries with trends, top activities, and cost analysis.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/summarizer.js week` and display the markdown output.

### `/diary:search <query>` — Search History
Search across all historical agent activity events.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/analytics.js search "<query>"` and display matching events.

### `/diary:export` — Export Data
Export diary data in Markdown, HTML, or JSON format.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/analytics.js export [format]` where format is `md`, `html`, or `json`. Default is `md`.

### `/diary:clear` — Clear History
Delete all historical diary data. Requires `--yes` flag to confirm deletion.

**Implementation:** Run `node /path/to/claw-diary/dist/scripts/analytics.js clear --yes` after user confirms. Without `--yes`, the command prints a warning and exits without deleting.

## Privacy & Security

- All data stored locally at `~/.claw-diary/` — nothing uploaded to any server
- Automatic sanitization of env variables, API keys, passwords, and tokens
- Configurable recording level: `full` | `summary` | `minimal`
- One-click data deletion via `/diary:clear`

## External Endpoints

This skill makes **no external network requests**. All processing is local.

## Trust Statement

claw-diary only reads from stdin (hook event data) and writes to `~/.claw-diary/`. It does not access the network, modify your codebase, or read files outside its data directory.

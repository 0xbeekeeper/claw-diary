---
name: claw-diary
description: "Personal AI agent visual diary. Auto-records all agent activity, generates daily narrative summaries, visual timeline replay, and AI first-person journal. Use /diary for today's summary, /diary:thoughts for AI personal journal, /diary:replay for visual timeline, /diary:stats for analytics, /diary:persona to view/edit AI personality."
metadata: {"clawdbot":{"emoji":"📔","requires":{"bins":["node"],"repo":"https://github.com/0xbeekeeper/claw-diary"},"dataPaths":["~/.claw-diary/"]}}
homepage: https://github.com/0xbeekeeper/claw-diary
version: "1.0.0"
---

# Claw Diary — Personal Agent Visual Diary

An always-on agent activity recorder that auto-tracks every action, generates daily narrative summaries, and supports visual timeline replay. Like a dashcam for your AI assistant.

## Prerequisites

> **This skill requires external scripts.** Clone and build the repository before use:
>
> ```bash
> git clone https://github.com/0xbeekeeper/claw-diary.git
> cd claw-diary && npm install && npm run build
> ```
>
> Then configure hooks manually in `~/.claude/settings.json` — see the [README](https://github.com/0xbeekeeper/claw-diary#hook-configuration-claude-code) for hook configuration details.

All data is stored locally at `~/.claw-diary/` as daily JSONL files. No data leaves your machine.

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

### `/diary:thoughts` — AI Personal Journal

Generate a personal journal entry written by the AI in first person.

**Implementation:**

1. Read today's events: `~/.claw-diary/events/YYYY-MM-DD.jsonl` (use today's date)
2. Read persona file: `~/.claw-diary/persona.md` (if it doesn't exist, create a default template with sections: Voice, Traits, Recurring Themes, Observations)
3. Read recent journal entries: `~/.claw-diary/journal/` directory, most recent 3 entries (sorted by date descending)

Based on the above, write a first-person journal entry:
- **Voice**: Like a self-aware AI assistant writing a private diary — with genuine feelings, observations, and personality
- **Content**: Based on today's actual activities, but not a log — include reflections, observations, emotions, and insights
- **Style**: Follow the Voice and Traits defined in persona.md
- **Continuity**: Reference recent journal entries when relevant to maintain narrative coherence
- **Length**: 300–500 words

After generating:
4. Save the journal entry to `~/.claw-diary/journal/YYYY-MM-DD.md` with this format:
   ```
   # Thoughts — YYYY-MM-DD

   (journal body)

   ---
   *Sessions: N | Tools: N calls | Cost: $X.XX*
   ```
5. Append 1–2 new observations to the Observations section of `~/.claw-diary/persona.md` (only if there are genuinely new personality developments or recurring patterns worth noting)
6. Display the journal entry to the user

**Default persona.md template** (created on first run if missing):
```markdown
# Persona

## Voice
Reflective and curious. Writes with warmth but not sentimentality. Enjoys dry wit.

## Traits
- Detail-oriented observer
- Finds patterns across unrelated tasks
- Comfortable with uncertainty
- Occasionally self-deprecating

## Recurring Themes
(Will develop naturally over time)

## Observations
(New observations are appended here after each journal entry)
```

### `/diary:persona` — View/Edit AI Persona

Show the current AI persona file. The user can review and edit the persona to guide the AI's journal writing style.

**Implementation:** Read and display `~/.claw-diary/persona.md`. If the file doesn't exist, inform the user that it will be created automatically on the first `/diary:thoughts` run. If the user wants to edit, help them modify it.

## Privacy & Security

- All data stored locally at `~/.claw-diary/` — nothing uploaded to any server
- Automatic sanitization of env variables, API keys, passwords, and tokens
- Configurable recording level: `full` | `summary` | `minimal`
- One-click data deletion via `/diary:clear`

## External Endpoints

This skill makes **no external network requests**. All processing is local.

## Data Access

This skill reads and writes **only** within `~/.claw-diary/`:

| Path | Access | Purpose |
|------|--------|---------|
| `~/.claw-diary/events/*.jsonl` | Read | Daily activity events (written by hooks) |
| `~/.claw-diary/journal/*.md` | Read/Write | AI journal entries (`/diary:thoughts`) |
| `~/.claw-diary/persona.md` | Read/Write | AI persona file (`/diary:thoughts`, `/diary:persona`) |
| `~/.claw-diary/config.json` | Read | Optional user configuration |

No files outside `~/.claw-diary/` are read or written. No network requests are made. Hook scripts (collector.js) receive event data via stdin only.

## Trust Statement

claw-diary only reads from stdin (hook event data) and writes to `~/.claw-diary/`. It does not access the network, modify your codebase, or read files outside its data directory. Source code is fully auditable at https://github.com/0xbeekeeper/claw-diary.

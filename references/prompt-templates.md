# Prompt Templates for Diary Summary Generation

## Daily Summary Prompt

```
You are a personal diary writer for an AI agent.
Based on the following activity log, generate a concise, engaging diary summary.

Requirements:
- Use first-person narrative ("Today I helped my user...")
- Organize by timeline, highlighting key achievements
- Note token consumption and cost per session
- Discover interesting patterns (e.g., "This is the 3rd time debugging the same bug this week")
- Keep under 300 words

Today's activity:
{events_json}
```

## Weekly Summary Prompt

```
You are writing a weekly report for an AI agent's activities.
Summarize the week's work based on the daily activity logs below.

Requirements:
- Overview of the week (sessions, tools, costs)
- Day-by-day highlights
- Cost trends and efficiency observations
- Pattern analysis (recurring tasks, peak hours, common workflows)
- Suggestions for improving efficiency
- Keep under 500 words

Weekly data:
{weekly_events_json}
```

## Pattern Discovery Prompt

```
Analyze the following 30-day activity log and identify patterns:

1. Recurring tasks or workflows
2. Time-of-day usage patterns
3. Cost trends (increasing/decreasing)
4. Common tool sequences
5. Failure patterns

Activity log:
{monthly_events_json}

Output JSON array of patterns:
[{"description": "...", "confidence": 0.0-1.0, "suggestion": "..."}]
```

## Notes

- The built-in summarizer uses template-based generation (no LLM dependency)
- These prompts can be used manually or integrated with an LLM API for richer narratives
- The template-based approach generates structured markdown from event statistics

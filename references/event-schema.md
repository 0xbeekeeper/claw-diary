# Event Data Schema

## DiaryEvent

Each event is stored as a single JSON line in a `.jsonl` file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Unique event identifier |
| `timestamp` | string (ISO 8601) | yes | When the event occurred |
| `sessionId` | string (UUID) | yes | Agent session identifier |
| `type` | enum | yes | `tool_call`, `tool_result`, `session_start`, `session_end` |
| `toolName` | string | no | Name of the tool being called |
| `toolArgs` | object | no | Tool parameters (sanitized) |
| `result` | object | no | Tool result info |
| `result.success` | boolean | no | Whether the tool call succeeded |
| `result.outputPreview` | string | no | First 200 characters of output |
| `tokenUsage` | object | no | Token consumption |
| `tokenUsage.input` | number | no | Input tokens |
| `tokenUsage.output` | number | no | Output tokens |
| `tokenUsage.estimatedCost` | number | no | Estimated cost in USD |
| `model` | string | no | Model used (e.g., `claude-opus-4-6`) |
| `duration` | number | no | Duration in milliseconds |

## Storage

- **Location**: `~/.claw-diary/events/`
- **File format**: One file per day, named `YYYY-MM-DD.jsonl`
- **Encoding**: UTF-8, one JSON object per line

## Sanitization

The following are automatically redacted:
- Environment variable values matching sensitive patterns (API keys, tokens, passwords)
- Strings matching common secret patterns (sk-*, ghp_*, bearer tokens, private keys)
- Object keys containing: SECRET, PASSWORD, TOKEN, KEY

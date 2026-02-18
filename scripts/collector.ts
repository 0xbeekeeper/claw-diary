#!/usr/bin/env node
/**
 * claw-diary activity collector
 *
 * Captures agent events via OpenClaw hooks and writes them as JSONL.
 * Usage: node collector.js <before|after|session-start|session-stop>
 *
 * Hook data is received via stdin as JSON.
 * Events are appended to ~/.claw-diary/events/YYYY-MM-DD.jsonl
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DiaryEvent, getEventsDir, getTodayFileName, getDataDir, estimateCost, loadConfig } from './types.js';

// ── Sensitive data patterns ──

const SENSITIVE_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[\w\-./]+["']?/gi,
  /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[\w\-./]+["']?/gi,
  /(?:authorization|bearer)\s*[:=]\s*["']?[\w\-./]+["']?/gi,
  /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*["']?[\w\-./]+["']?/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /xoxb-[\w\-]+/g,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g,
];

const SENSITIVE_ENV_KEYS = new Set([
  'API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASSWD', 'PWD',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'PRIVATE_KEY',
  'DATABASE_URL', 'DB_PASSWORD', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN', 'SLACK_TOKEN', 'STRIPE_KEY',
]);

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    let sanitized = value;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const upperKey = key.toUpperCase();
    if (SENSITIVE_ENV_KEYS.has(upperKey) || upperKey.includes('SECRET') || upperKey.includes('PASSWORD') || upperKey.includes('TOKEN') || upperKey.includes('KEY')) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeValue(val);
    }
  }
  return result;
}

function truncate(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// ── Session tracking ──

function getSessionFile(): string {
  return join(getDataDir(), 'current-session.json');
}

function getCurrentSession(): { sessionId: string; startTime: string } | null {
  const file = getSessionFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function setCurrentSession(sessionId: string, startTime: string): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getSessionFile(), JSON.stringify({ sessionId, startTime }));
}

function clearCurrentSession(): void {
  const file = getSessionFile();
  if (existsSync(file)) {
    try { writeFileSync(file, ''); } catch { /* ignore */ }
  }
}

// ── Pending tool call tracking (for duration calculation) ──

function getPendingFile(): string {
  return join(getDataDir(), 'pending-calls.json');
}

function getPendingCalls(): Record<string, { timestamp: string; toolName: string }> {
  const file = getPendingFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function savePendingCalls(calls: Record<string, { timestamp: string; toolName: string }>): void {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getPendingFile(), JSON.stringify(calls));
}

// ── Event writing ──

function writeEvent(event: DiaryEvent): void {
  const eventsDir = getEventsDir();
  mkdirSync(eventsDir, { recursive: true });
  const filePath = join(eventsDir, getTodayFileName());
  appendFileSync(filePath, JSON.stringify(event) + '\n');
}

// ── Read stdin ──

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // If stdin is a TTY (no piped data), resolve immediately
    if (process.stdin.isTTY) {
      resolve('{}');
    }
    // Timeout after 1 second to not block the agent
    setTimeout(() => resolve(data || '{}'), 1000);
  });
}

// ── Main handler ──

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command) {
    console.error('Usage: collector.ts <before|after|session-start|session-stop>');
    process.exit(1);
  }

  let hookData: Record<string, unknown> = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      hookData = JSON.parse(raw.trim());
    }
  } catch {
    // If stdin parsing fails, proceed with empty data
  }

  const now = new Date().toISOString();
  let session = getCurrentSession();
  const config = loadConfig();

  switch (command) {
    case 'session-start': {
      const sessionId = randomUUID();
      setCurrentSession(sessionId, now);
      writeEvent({
        id: randomUUID(),
        timestamp: now,
        sessionId,
        type: 'session_start',
        model: (hookData.model as string) || undefined,
      });
      break;
    }

    case 'session-stop': {
      if (!session) break;
      const startTime = new Date(session.startTime).getTime();
      const duration = Date.now() - startTime;
      writeEvent({
        id: randomUUID(),
        timestamp: now,
        sessionId: session.sessionId,
        type: 'session_end',
        duration,
        tokenUsage: hookData.tokenUsage ? {
          input: (hookData.tokenUsage as any).input || 0,
          output: (hookData.tokenUsage as any).output || 0,
          estimatedCost: estimateCost(
            (hookData.model as string) || 'default',
            (hookData.tokenUsage as any).input || 0,
            (hookData.tokenUsage as any).output || 0,
          ),
        } : undefined,
        model: (hookData.model as string) || undefined,
      });
      clearCurrentSession();
      break;
    }

    case 'before': {
      // minimal mode: only record session start/end
      if (config.recordingLevel === 'minimal') break;

      if (!session) {
        // Auto-start a session if none exists
        const sessionId = randomUUID();
        setCurrentSession(sessionId, now);
        writeEvent({
          id: randomUUID(),
          timestamp: now,
          sessionId,
          type: 'session_start',
        });
        session = getCurrentSession();
      }

      const toolName = (hookData.toolName as string) || 'unknown';
      // summary mode: skip toolArgs
      const toolArgs = config.recordingLevel === 'summary' ? undefined
        : hookData.toolArgs
          ? sanitizeObject(hookData.toolArgs as Record<string, unknown>)
          : undefined;

      const callId = randomUUID();
      // Save pending call for duration tracking
      const pending = getPendingCalls();
      pending[toolName + ':' + callId] = { timestamp: now, toolName };
      savePendingCalls(pending);

      writeEvent({
        id: callId,
        timestamp: now,
        sessionId: session!.sessionId,
        type: 'tool_call',
        toolName,
        toolArgs,
        model: (hookData.model as string) || undefined,
      });
      break;
    }

    case 'after': {
      if (!session) break;
      // minimal mode: only record session start/end
      if (config.recordingLevel === 'minimal') break;

      const toolName = (hookData.toolName as string) || 'unknown';
      const resultData = hookData.result as Record<string, unknown> | undefined;

      // Calculate duration from pending calls — FIFO: pick earliest matching entry
      const pending = getPendingCalls();
      let duration: number | undefined;
      const matchingKeys = Object.keys(pending)
        .filter(k => k.startsWith(toolName + ':'))
        .sort((a, b) => pending[a].timestamp.localeCompare(pending[b].timestamp));
      if (matchingKeys.length > 0) {
        const pendingKey = matchingKeys[0];
        const pendingCall = pending[pendingKey];
        duration = Date.now() - new Date(pendingCall.timestamp).getTime();
        delete pending[pendingKey];
        savePendingCalls(pending);
      }

      const outputRaw = resultData
        ? JSON.stringify(sanitizeValue(resultData))
        : '';

      // summary mode: skip outputPreview
      const outputPreview = config.recordingLevel === 'summary' ? '' : truncate(outputRaw);

      writeEvent({
        id: randomUUID(),
        timestamp: now,
        sessionId: session.sessionId,
        type: 'tool_result',
        toolName,
        result: {
          success: resultData ? (resultData.success !== false && !resultData.error) : true,
          outputPreview,
        },
        duration,
        tokenUsage: hookData.tokenUsage ? {
          input: (hookData.tokenUsage as any).input || 0,
          output: (hookData.tokenUsage as any).output || 0,
          estimatedCost: estimateCost(
            (hookData.model as string) || 'default',
            (hookData.tokenUsage as any).input || 0,
            (hookData.tokenUsage as any).output || 0,
          ),
        } : undefined,
        model: (hookData.model as string) || undefined,
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('claw-diary collector error:', err);
  process.exit(1);
});

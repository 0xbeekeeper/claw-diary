import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiaryEvent, getDateFileName } from '../scripts/types.js';
import { generateTimelineHtml } from '../scripts/timeline.js';

const TEST_DIR = join(process.env.HOME || '/tmp', '.claw-diary-test-' + randomUUID().slice(0, 8));
const TEST_EVENTS_DIR = join(TEST_DIR, 'events');

function makeEvent(overrides: Partial<DiaryEvent> = {}): DiaryEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: randomUUID(),
    type: 'tool_call',
    toolName: 'Read',
    ...overrides,
  };
}

describe('smoke: JSONL round-trip', () => {
  const testDate = new Date();
  const fileName = getDateFileName(testDate);

  before(() => {
    mkdirSync(TEST_EVENTS_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('writes and reads JSONL events', () => {
    const events: DiaryEvent[] = [
      makeEvent({ toolName: 'Read', type: 'tool_call' }),
      makeEvent({ toolName: 'Read', type: 'tool_result', result: { success: true, outputPreview: 'file content...' } }),
      makeEvent({ toolName: 'Edit', type: 'tool_call' }),
      makeEvent({ toolName: 'Bash', type: 'tool_call', tokenUsage: { input: 1000, output: 500, estimatedCost: 0.01 } }),
    ];

    const filePath = join(TEST_EVENTS_DIR, fileName);
    const jsonl = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(filePath, jsonl);

    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const loaded: DiaryEvent[] = lines.map(l => JSON.parse(l));

    assert.equal(loaded.length, 4);
    assert.equal(loaded[0].toolName, 'Read');
    assert.equal(loaded[1].result?.success, true);
    assert.equal(loaded[3].tokenUsage?.estimatedCost, 0.01);
  });
});

describe('smoke: generateTimelineHtml', () => {
  it('returns valid HTML for empty events', () => {
    const html = generateTimelineHtml([], 'Test Day');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Test Day'));
    assert.ok(html.includes('</html>'));
  });

  it('returns valid HTML with events', () => {
    const sessionId = randomUUID();
    const events: DiaryEvent[] = [
      makeEvent({ sessionId, type: 'session_start', toolName: undefined }),
      makeEvent({ sessionId, toolName: 'Read', type: 'tool_call' }),
      makeEvent({ sessionId, toolName: 'Read', type: 'tool_result', result: { success: true, outputPreview: 'ok' } }),
      makeEvent({ sessionId, toolName: 'Edit', type: 'tool_call', tokenUsage: { input: 5000, output: 2000, estimatedCost: 0.05 } }),
      makeEvent({ sessionId, type: 'session_end', toolName: undefined }),
    ];

    const html = generateTimelineHtml(events, '2025-01-15');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('2025-01-15'));
    assert.ok(html.includes('Read'));
    assert.ok(html.includes('Edit'));
    assert.ok(html.includes('$'));
  });
});

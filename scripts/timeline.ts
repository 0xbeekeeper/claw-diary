#!/usr/bin/env node
/**
 * claw-diary timeline generator
 *
 * Generates an interactive HTML timeline with a diary/journal aesthetic.
 * Usage:
 *   node timeline.js [YYYY-MM-DD]  — Generate timeline for a date (default: today)
 *   node timeline.js week          — Generate timeline for this week
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DiaryEvent, getDataDir, getDateFileName, loadEventsForDate, loadEventsForDays } from './types.js';

// ── Terminal color for tool types ──

function getEventColor(event: DiaryEvent): string {
  if (event.type === 'session_start') return '#666';
  if (event.type === 'session_end') return '#666';
  if (event.result && !event.result.success) return '#e14a4a';

  const tool = (event.toolName || '').toLowerCase();
  if (tool.includes('read') || tool.includes('grep') || tool.includes('glob')) return '#4ac8e1';
  if (tool.includes('edit') || tool.includes('write')) return '#e1a84a';
  if (tool.includes('bash')) return '#4ae168';
  if (tool.includes('web') || tool.includes('search')) return '#5a8abf';
  if (tool.includes('lsp')) return '#a07acc';
  if (tool.includes('task')) return '#cc7aa0';
  return '#666';
}

function getEventIcon(event: DiaryEvent): string {
  if (event.type === 'session_start') return '\u25B6';
  if (event.type === 'session_end') return '\u25A0';
  if (event.result && !event.result.success) return '\u2717';

  const tool = (event.toolName || '').toLowerCase();
  if (tool.includes('read')) return '\uD83D\uDCD6';
  if (tool.includes('grep') || tool.includes('glob')) return '\uD83D\uDD0D';
  if (tool.includes('edit') || tool.includes('write')) return '\u270F\uFE0F';
  if (tool.includes('bash')) return '\u26A1';
  if (tool.includes('web') || tool.includes('search')) return '\uD83C\uDF10';
  if (tool.includes('lsp')) return '\uD83E\uDDE0';
  if (tool.includes('task')) return '\uD83D\uDD00';
  return '\u25CF';
}

function getNodeSize(event: DiaryEvent): number {
  const tokens = event.tokenUsage ? event.tokenUsage.input + event.tokenUsage.output : 0;
  if (tokens === 0) return 8;
  if (tokens < 1000) return 10;
  if (tokens < 5000) return 14;
  if (tokens < 20000) return 18;
  return 22;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Summary generation helpers ──

interface SessionInfo {
  id: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  toolCalls: number;
  failures: number;
  tokens: number;
  cost: number;
  topTools: { name: string; count: number }[];
  category: string;
}

function computeSummary(events: DiaryEvent[]) {
  const sessionMap = new Map<string, DiaryEvent[]>();
  for (const e of events) {
    const arr = sessionMap.get(e.sessionId) || [];
    arr.push(e);
    sessionMap.set(e.sessionId, arr);
  }

  let totalTokens = 0;
  let totalCost = 0;
  let totalToolCalls = 0;
  let totalFailures = 0;
  const toolCounts = new Map<string, number>();

  for (const e of events) {
    if (e.tokenUsage) {
      totalTokens += e.tokenUsage.input + e.tokenUsage.output;
      totalCost += e.tokenUsage.estimatedCost;
    }
    if (e.type === 'tool_call') {
      totalToolCalls++;
      if (e.toolName) toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    }
    if (e.type === 'tool_result' && e.result && !e.result.success) totalFailures++;
  }

  const sessions: SessionInfo[] = [];
  for (const [sid, sevents] of sessionMap) {
    const sorted = sevents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const start = sorted[0].timestamp;
    const end = sorted[sorted.length - 1].timestamp;
    const dur = new Date(end).getTime() - new Date(start).getTime();
    const calls = sevents.filter(e => e.type === 'tool_call');
    const fails = sevents.filter(e => e.type === 'tool_result' && e.result && !e.result.success);
    let stok = 0, scost = 0;
    sevents.forEach(e => {
      if (e.tokenUsage) { stok += e.tokenUsage.input + e.tokenUsage.output; scost += e.tokenUsage.estimatedCost; }
    });
    const tc = new Map<string, number>();
    calls.forEach(e => { if (e.toolName) tc.set(e.toolName, (tc.get(e.toolName) || 0) + 1); });
    const topTools = [...tc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => ({ name, count }));
    const cat = categorize(topTools.map(t => t.name));
    sessions.push({ id: sid, startTime: start, endTime: end, durationMs: dur, toolCalls: calls.length, failures: fails.length, tokens: stok, cost: scost, topTools, category: cat });
  }
  sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const readOps = events.filter(e => e.type === 'tool_call' && e.toolName && /read|grep|glob/i.test(e.toolName)).length;
  const writeOps = events.filter(e => e.type === 'tool_call' && e.toolName && /edit|write/i.test(e.toolName)).length;
  const shellOps = events.filter(e => e.type === 'tool_call' && e.toolName && /bash/i.test(e.toolName)).length;
  const webOps = events.filter(e => e.type === 'tool_call' && e.toolName && /web|search/i.test(e.toolName)).length;

  // mood
  let mood = 'calm';
  if (totalToolCalls > 20) mood = 'productive';
  if (totalFailures > totalToolCalls * 0.3) mood = 'bumpy';
  if (totalToolCalls === 0) mood = 'quiet';
  if (sessions.length >= 3 && totalFailures === 0) mood = 'stellar';

  return { sessions, totalTokens, totalCost, totalToolCalls, totalFailures, toolCounts, readOps, writeOps, shellOps, webOps, mood };
}

function categorize(toolNames: string[]): string {
  const lower = toolNames.map(t => t.toLowerCase());
  if (lower.some(t => t.includes('web') || t.includes('search'))) return 'Research';
  if (lower.some(t => t.includes('edit') || t.includes('write'))) {
    if (lower.some(t => t.includes('bash'))) return 'Coding & Testing';
    return 'Writing';
  }
  if (lower.some(t => t.includes('bash'))) return 'DevOps';
  if (lower.some(t => t.includes('read') || t.includes('grep'))) return 'Code Review';
  return 'Activity';
}

function fmtDuration(ms: number): string {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + ' min';
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── HTML generation ──

export function generateTimelineHtml(events: DiaryEvent[], title: string): string {
  const eventsJson = JSON.stringify(events.map(e => ({
    ...e,
    _color: getEventColor(e),
    _icon: getEventIcon(e),
    _size: getNodeSize(e),
  })));

  const summary = computeSummary(events);

  // Build the daily summary narrative
  const moodEmoji: Record<string, string> = { quiet: '\uD83C\uDF19', calm: '\u2615', productive: '\uD83D\uDD25', bumpy: '\u26C8\uFE0F', stellar: '\u2728' };
  const moodWord: Record<string, string> = { quiet: 'quiet', calm: 'calm', productive: 'productive', bumpy: 'a bit bumpy', stellar: 'stellar' };
  const moodE = moodEmoji[summary.mood] || '\u2615';
  const moodW = moodWord[summary.mood] || 'ordinary';

  // Build session cards HTML
  const sessionCardsHtml = summary.sessions.map((s, i) => {
    const tools = s.topTools.map(t => '<span class="tool-pill">' + escapeHtml(t.name) + ' \u00D7' + t.count + '</span>').join(' ');
    const failHtml = s.failures > 0 ? ' <span class="fail-badge">' + s.failures + ' failed</span>' : '';
    return '<div class="session-card">'
      + '<div class="session-card-header">'
      + '<span class="session-num">Session ' + (i + 1) + '</span>'
      + '<span class="session-category">' + escapeHtml(s.category) + '</span>'
      + '</div>'
      + '<div class="session-card-time">' + fmtTime(s.startTime) + ' \u2013 ' + fmtTime(s.endTime) + ' \u00B7 ' + fmtDuration(s.durationMs) + '</div>'
      + '<div class="session-card-stats">'
      + '<span>' + s.toolCalls + ' calls</span>'
      + '<span>' + fmtTokens(s.tokens) + ' tokens</span>'
      + '<span class="cost-text">$' + s.cost.toFixed(2) + '</span>'
      + failHtml
      + '</div>'
      + '<div class="session-card-tools">' + tools + '</div>'
      + '</div>';
  }).join('\n');

  // Activity breakdown bar
  const total = Math.max(summary.totalToolCalls, 1);
  const readPct = (summary.readOps / total * 100).toFixed(1);
  const writePct = (summary.writeOps / total * 100).toFixed(1);
  const shellPct = (summary.shellOps / total * 100).toFixed(1);
  const webPct = (summary.webOps / total * 100).toFixed(1);
  const otherPct = (100 - parseFloat(readPct) - parseFloat(writePct) - parseFloat(shellPct) - parseFloat(webPct)).toFixed(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} \u2014 Claw Diary</title>
<style>
:root {
  --bg: #0c0c0c;
  --surface: #141414;
  --surface2: #1a1a1a;
  --border: #2a2a2a;
  --border-light: #333;
  --text: #b0b0b0;
  --text-dim: #666;
  --text-ghost: #3a3a3a;
  --green: #4ae168;
  --green-dim: #2a8a3c;
  --green-glow: rgba(74,225,104,0.08);
  --amber: #e1a84a;
  --amber-dim: #8a6a2a;
  --red: #e14a4a;
  --red-dim: #8a2a2a;
  --cyan: #4ac8e1;
  --cyan-dim: #2a7a8a;
  --blue: #5a8abf;
  --purple: #a07acc;
  --pink: #cc7aa0;
  --white: #e0e0e0;
  --gold: #c4a265;
  --mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--mono);
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
  line-height: 1.65;
  min-height: 100vh;
}

/* ── Terminal window ── */
.diary-book {
  max-width: 900px;
  margin: 20px auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
}
/* title bar */
.diary-book::before {
  content: '';
  display: block;
  height: 36px;
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  background-image:
    radial-gradient(circle at 20px 18px, #ff5f57 5px, transparent 5px),
    radial-gradient(circle at 40px 18px, #febc2e 5px, transparent 5px),
    radial-gradient(circle at 60px 18px, #28c840 5px, transparent 5px);
}
.diary-book::after { display: none; }

.page-content {
  padding: 24px 28px;
  border-left: none;
  background: none;
}

/* ── Header ── */
.diary-header {
  text-align: left;
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px dashed var(--border-light);
}
.diary-date {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--green);
  letter-spacing: 0;
}
.diary-date::before { content: '> '; color: var(--text-dim); }
.diary-subtitle {
  font-style: normal;
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 2px;
}
.diary-subtitle::before { content: '# '; color: var(--text-ghost); }
.diary-mood {
  display: inline-block;
  margin-top: 8px;
  padding: 3px 12px;
  border: 1px solid var(--border-light);
  border-radius: 3px;
  font-size: 12px;
  color: var(--amber);
  background: rgba(225,168,74,0.06);
}

/* ── Summary ── */
.summary-section { margin-bottom: 28px; }
.summary-section h2 {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--cyan);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.summary-section h2::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.summary-narrative {
  font-style: normal;
  color: var(--text);
  font-size: 13px;
  line-height: 1.8;
  padding: 14px 16px;
  background: var(--green-glow);
  border-radius: 4px;
  border-left: 3px solid var(--green-dim);
  margin-bottom: 14px;
}
.summary-briefing { margin-bottom: 18px; }
.briefing-session {
  margin-bottom: 10px;
  padding: 10px 14px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.briefing-session-title {
  font-weight: 500;
  font-size: 13px;
  color: var(--amber);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.briefing-session-title::before { content: '\u25B8 '; }
.briefing-session-title .time-range {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-dim);
}
.briefing-items { list-style: none; padding: 0; }
.briefing-items li {
  position: relative;
  padding-left: 20px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.7;
}
.briefing-items li::before {
  content: '$';
  position: absolute;
  left: 2px;
  color: var(--text-dim);
  font-size: 11px;
}
.briefing-items li .file-ref {
  color: var(--cyan);
  background: rgba(74,200,225,0.06);
  padding: 1px 5px;
  border-radius: 2px;
}
.briefing-items li .cmd-ref {
  color: var(--green);
  background: rgba(74,225,104,0.06);
  padding: 1px 5px;
  border-radius: 2px;
}
.briefing-items li .search-ref { font-style: italic; color: var(--text-dim); }
.briefing-items li .fail-ref { color: var(--red); font-weight: 500; }
.briefing-items li .ok-ref { color: var(--green); }

/* ── Stats ── */
.summary-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 18px;
}
.stat-card {
  text-align: center;
  padding: 12px 8px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.stat-card .stat-value {
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 600;
  color: var(--green);
}
.stat-card .stat-label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-dim);
  letter-spacing: 1px;
  margin-top: 2px;
}

/* activity bar */
.activity-bar-container { margin-bottom: 8px; }
.activity-bar-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
.activity-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--border);
}
.activity-bar > div { height: 100%; transition: width 0.3s; }
.bar-read { background: var(--cyan); }
.bar-write { background: var(--amber); }
.bar-shell { background: var(--green); }
.bar-web { background: var(--blue); }
.bar-other { background: var(--text-ghost); }
.activity-bar-legend {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.legend-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}

/* Session cards */
.session-cards { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.session-card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface2);
  transition: border-color 0.2s;
}
.session-card:hover { border-color: var(--green-dim); }
.session-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.session-num { font-weight: 500; font-size: 13px; color: var(--green); }
.session-category {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.session-card-time { font-size: 11px; color: var(--text-dim); }
.session-card-stats {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-dim);
}
.session-card-stats .cost-text { color: var(--amber); font-weight: 500; }
.session-card-stats .fail-badge { color: var(--red); font-weight: 500; }
.session-card-tools { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
.tool-pill {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
}

/* ── Cost curve ── */
.cost-section {
  margin-bottom: 8px;
  padding: 14px;
  background: var(--surface2);
  border-radius: 4px;
  border: 1px solid var(--border);
}
.cost-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.cost-header span { font-size: 11px; color: var(--text-dim); }
.cost-header .cost-total { font-weight: 600; color: var(--amber); font-size: 14px; }
.cost-canvas-wrap { height: 56px; position: relative; }
.cost-canvas-wrap canvas { width: 100%; height: 100%; }

/* ── Divider ── */
.section-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0 20px;
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
}
.section-divider::before, .section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
  border: none;
}

/* ── Controls ── */
.controls-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.controls-bar input {
  flex: 1;
  min-width: 160px;
  padding: 7px 12px;
  border: 1px solid var(--border-light);
  border-radius: 4px;
  background: var(--bg);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  outline: none;
  transition: border-color 0.2s;
}
.controls-bar input:focus { border-color: var(--green-dim); }
.controls-bar input::placeholder { color: var(--text-ghost); }
.controls-bar select {
  padding: 7px 12px;
  border: 1px solid var(--border-light);
  border-radius: 4px;
  background: var(--bg);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.controls-bar button {
  padding: 7px 16px;
  border: 1px solid var(--green-dim);
  border-radius: 4px;
  background: var(--bg);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--green);
  cursor: pointer;
  transition: all 0.15s;
}
.controls-bar button:hover { background: var(--green-dim); color: var(--bg); }
.controls-bar button.active { background: var(--green); color: var(--bg); border-color: var(--green); }

/* ── Floating replay FAB ── */
.replay-fab {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 200;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  border: 1px solid var(--green-dim);
  background: var(--surface);
  color: var(--green);
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  display: none;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, box-shadow 0.15s;
  line-height: 1;
}
.replay-fab:hover {
  transform: scale(1.06);
  box-shadow: 0 6px 28px rgba(0,0,0,0.6);
  border-color: var(--green);
}
.replay-fab:active { transform: scale(0.95); }
.replay-fab.visible { display: flex; }
.replay-fab svg {
  position: absolute;
  top: -1px; left: -1px;
  width: 54px; height: 54px;
  transform: rotate(-90deg);
  pointer-events: none;
}
.replay-fab svg circle {
  fill: none;
  stroke: var(--green);
  stroke-width: 2;
  stroke-dasharray: 164;
  stroke-dashoffset: 164;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.4s;
}
.replay-fab .counter {
  position: absolute;
  top: -6px; right: -6px;
  min-width: 20px;
  height: 20px;
  border-radius: 3px;
  background: var(--green);
  color: var(--bg);
  font-size: 9px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* ── Timeline ── */
.timeline-section h2 {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--cyan);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.timeline-section h2::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.timeline {
  position: relative;
  padding-left: 28px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: var(--border-light);
}
.event {
  position: relative;
  margin-bottom: 2px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 4px;
  transition: all 0.12s;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.event:hover { background: var(--surface2); }
.event.selected { background: var(--surface2); outline: 1px solid var(--green-dim); }
.event.session-marker {
  margin-top: 16px;
  margin-bottom: 4px;
  cursor: default;
}
.event-dot {
  position: absolute;
  left: -24px;
  top: 11px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  z-index: 1;
}
.event-icon { font-size: 13px; flex-shrink: 0; width: 20px; text-align: center; }
.event-content { flex: 1; min-width: 0; }
.event-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.event-tool { font-weight: 500; font-size: 12px; }
.event-time { font-size: 10px; color: var(--text-dim); }
.event-type {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.event-preview {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: normal;
}
.event-cost { font-size: 10px; color: var(--amber); margin-top: 2px; }

/* ── Detail panel ── */
.detail-overlay {
  display: none;
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 420px;
  background: var(--surface);
  border-left: 1px solid var(--border-light);
  box-shadow: -8px 0 30px rgba(0,0,0,0.4);
  z-index: 100;
  overflow-y: auto;
  padding: 28px 24px;
  animation: slideIn 0.15s ease;
}
.detail-overlay.visible { display: block; }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

.detail-close {
  position: absolute;
  top: 12px; right: 12px;
  background: none; border: 1px solid var(--border);
  font-size: 14px; cursor: pointer;
  color: var(--text-dim);
  padding: 4px 8px; border-radius: 3px;
  font-family: var(--mono);
}
.detail-close:hover { background: var(--surface2); color: var(--text); }
.detail-overlay h2 {
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 500;
  color: var(--green);
  margin-bottom: 18px;
  padding-right: 32px;
}
.detail-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 18px;
}
.detail-meta-item {
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--surface2);
  border: 1px solid var(--border);
}
.detail-meta-item .label { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
.detail-meta-item .value { font-size: 13px; font-weight: 500; color: var(--text); margin-top: 2px; }
.detail-section { margin-bottom: 16px; }
.detail-section h3 {
  font-size: 10px; color: var(--text-dim); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 6px;
}
.detail-section pre {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
  line-height: 1.5;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}
.empty-state .big { font-size: 36px; margin-bottom: 12px; }

.page-footer {
  text-align: center;
  padding: 20px 0 8px;
  color: var(--text-ghost);
  font-size: 11px;
}
.page-footer::before { content: '// '; }
.page-footer::after { content: ' //'; }

@media (max-width: 768px) {
  .diary-book { margin: 8px; border-radius: 6px; }
  .page-content { padding: 16px 14px; }
  .detail-overlay { width: 100%; }
  .summary-stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
</head>
<body>

<div class="diary-book">
  <div class="page-content">

    <!-- Header -->
    <div class="diary-header">
      <div class="diary-date">${escapeHtml(title)}</div>
      <div class="diary-subtitle">Agent Activity Diary</div>
      <div class="diary-mood">${moodE} A ${moodW} day</div>
    </div>

    <!-- Daily Summary -->
    <div class="summary-section">
      <h2>\u270D\uFE0F Today\u2019s Summary</h2>
      <div class="summary-narrative" id="narrative"></div>
      <div class="summary-briefing" id="briefing"></div>

      <div class="summary-stats">
        <div class="stat-card"><div class="stat-value">${summary.sessions.length}</div><div class="stat-label">Sessions</div></div>
        <div class="stat-card"><div class="stat-value">${summary.totalToolCalls}</div><div class="stat-label">Tool Calls</div></div>
        <div class="stat-card"><div class="stat-value">${fmtTokens(summary.totalTokens)}</div><div class="stat-label">Tokens</div></div>
        <div class="stat-card"><div class="stat-value">$${summary.totalCost.toFixed(2)}</div><div class="stat-label">Cost</div></div>
        <div class="stat-card"><div class="stat-value">${summary.totalFailures}</div><div class="stat-label">Failures</div></div>
      </div>

      <!-- Activity breakdown -->
      <div class="activity-bar-container">
        <div class="activity-bar-label">Activity Breakdown</div>
        <div class="activity-bar">
          <div class="bar-read" style="width:${readPct}%"></div>
          <div class="bar-write" style="width:${writePct}%"></div>
          <div class="bar-shell" style="width:${shellPct}%"></div>
          <div class="bar-web" style="width:${webPct}%"></div>
          <div class="bar-other" style="width:${otherPct}%"></div>
        </div>
        <div class="activity-bar-legend">
          <span><span class="legend-dot" style="background:var(--blue)"></span>Read ${readPct}%</span>
          <span><span class="legend-dot" style="background:var(--amber)"></span>Write ${writePct}%</span>
          <span><span class="legend-dot" style="background:var(--green)"></span>Shell ${shellPct}%</span>
          <span><span class="legend-dot" style="background:var(--blue)"></span>Web ${webPct}%</span>
        </div>
      </div>

      <!-- Session cards -->
      <div class="session-cards" style="margin-top:16px;">
        ${sessionCardsHtml}
      </div>

      <!-- Cost curve -->
      <div class="cost-section" style="margin-top:16px;">
        <div class="cost-header">
          <span>Cumulative Cost</span>
          <span class="cost-total" id="cost-total-label"></span>
        </div>
        <div class="cost-canvas-wrap">
          <canvas id="cost-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="section-divider">\u2022 Activity Log \u2022</div>

    <!-- Controls -->
    <div class="timeline-section">
      <div class="controls-bar">
        <input type="text" id="search" placeholder="Search entries\u2026" />
        <select id="filter">
          <option value="all">All</option>
          <option value="tool_call">Tool Calls</option>
          <option value="tool_result">Results</option>
          <option value="success">Successes</option>
          <option value="failure">Failures</option>
        </select>
        <button id="replay">\u25B6 Replay</button>
      </div>

      <!-- Timeline -->
      <div class="timeline" id="timeline"></div>
    </div>

    <div class="page-footer">\u2014 end of today\u2019s diary \u2014</div>
  </div>
</div>

<!-- Floating replay/pause FAB -->
<button class="replay-fab" id="replay-fab" onclick="toggleReplay()">
  <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="26" id="fab-ring"/></svg>
  <span id="fab-icon">\u23F8</span>
  <span class="counter" id="fab-counter"></span>
</button>

<!-- Detail panel -->
<div class="detail-overlay" id="detail">
  <button class="detail-close" onclick="closeDetail()">\u2715</button>
  <div id="detail-content"></div>
</div>

<script>
const EVENTS = ${eventsJson};
let filteredEvents = [...EVENTS];
let selectedIdx = -1;
let replayInterval = null;

// ── Narrative & briefing generation ──
function generateNarrative() {
  var totalCalls = EVENTS.filter(function(e) { return e.type === 'tool_call'; }).length;
  var failures = EVENTS.filter(function(e) { return e.type === 'tool_result' && e.result && !e.result.success; }).length;
  var totalCost = 0;
  EVENTS.forEach(function(e) { if (e.tokenUsage) totalCost += e.tokenUsage.estimatedCost; });

  if (EVENTS.length === 0) {
    document.getElementById('narrative').textContent = 'No entries today. The diary pages remain blank, waiting for the next adventure.';
    return;
  }

  // Group events by session
  var sessionMap = {};
  EVENTS.forEach(function(e) {
    if (!sessionMap[e.sessionId]) sessionMap[e.sessionId] = [];
    sessionMap[e.sessionId].push(e);
  });
  var sessionIds = Object.keys(sessionMap);

  // ── Build top-level narrative (one-paragraph executive summary) ──
  // Extract concrete details from each session
  var sessionBriefs = [];
  sessionIds.forEach(function(sid) {
    var sevts = sessionMap[sid].sort(function(a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
    var brief = extractSessionBrief(sevts);
    if (brief) sessionBriefs.push(brief);
  });

  var narParts = [];
  narParts.push('Today I completed ' + sessionIds.length + ' session' + (sessionIds.length > 1 ? 's' : '') + ' with ' + totalCalls + ' operations (cost: $' + totalCost.toFixed(2) + ').');
  sessionBriefs.forEach(function(b, i) {
    narParts.push('Session ' + (i + 1) + ': ' + b.oneLiner);
  });
  if (failures > 0) {
    narParts.push('Encountered ' + failures + ' failure' + (failures > 1 ? 's' : '') + ' along the way, all resolved.');
  }

  document.getElementById('narrative').innerHTML = esc(narParts.join(' '));

  // ── Build detailed briefing per session ──
  var briefingHtml = '';
  sessionIds.forEach(function(sid, si) {
    var sevts = sessionMap[sid].sort(function(a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
    var t0 = new Date(sevts[0].timestamp);
    var t1 = new Date(sevts[sevts.length - 1].timestamp);
    var timeRange = pad2(t0.getHours()) + ':' + pad2(t0.getMinutes()) + ' \\u2013 ' + pad2(t1.getHours()) + ':' + pad2(t1.getMinutes());
    var items = extractDetailedItems(sevts);

    briefingHtml += '<div class="briefing-session">';
    briefingHtml += '<div class="briefing-session-title">Session ' + (si + 1) + ' <span class="time-range">' + timeRange + '</span></div>';
    briefingHtml += '<ul class="briefing-items">';
    items.forEach(function(item) { briefingHtml += '<li>' + item + '</li>'; });
    briefingHtml += '</ul></div>';
  });

  document.getElementById('briefing').innerHTML = briefingHtml;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// Extract a one-line summary for a session
function extractSessionBrief(events) {
  var actions = [];
  var filesEdited = new Set();
  var filesRead = new Set();
  var searchQueries = [];
  var commands = [];
  var prNumbers = [];

  events.forEach(function(e) {
    if (e.type !== 'tool_call') return;
    var name = (e.toolName || '').toLowerCase();
    var args = e.toolArgs || {};

    if (name === 'edit' || name === 'write') {
      var fp = args.file_path || args.filePath || '';
      if (fp) filesEdited.add(shortPath(fp));
    }
    if (name === 'read') {
      var fp2 = args.file_path || args.filePath || '';
      if (fp2) filesRead.add(shortPath(fp2));
    }
    if (name === 'websearch' || name === 'web_search') {
      if (args.query) searchQueries.push(args.query);
    }
    if (name === 'webfetch' || name === 'web_fetch') {
      if (args.url) searchQueries.push('fetched ' + shortUrl(String(args.url)));
    }
    if (name === 'bash') {
      var cmd = args.command || '';
      commands.push(cmd);
      var prMatch = cmd.match(/\\bpr\\b[\\s]+(?:diff|review|view|list|merge|close)\\s+(\\d+)/i);
      if (prMatch) prNumbers.push('#' + prMatch[1]);
      var prMatch2 = cmd.match(/\\bpr\\b[\\s]+(?:list|create)/i);
      if (prMatch2 && !prMatch) prNumbers.push(cmd.trim().split(' ').slice(0,3).join(' '));
    }
    if (name === 'grep' || name === 'glob') {
      var p = args.pattern || '';
      if (p) actions.push('searched for \\u201C' + p + '\\u201D');
    }
  });

  var parts = [];
  if (filesEdited.size > 0) {
    parts.push('edited ' + Array.from(filesEdited).slice(0, 3).join(', ') + (filesEdited.size > 3 ? ' +' + (filesEdited.size - 3) + ' more' : ''));
  }
  if (prNumbers.length > 0) {
    parts.push('reviewed PR ' + prNumbers.join(', '));
  }
  if (searchQueries.length > 0) {
    parts.push('researched ' + searchQueries.slice(0, 2).map(function(q) { return '\\u201C' + truncStr(q, 40) + '\\u201D'; }).join(', '));
  }
  if (parts.length === 0 && filesRead.size > 0) {
    parts.push('explored ' + Array.from(filesRead).slice(0, 3).join(', '));
  }
  if (parts.length === 0 && commands.length > 0) {
    parts.push('ran ' + commands.length + ' shell command' + (commands.length > 1 ? 's' : ''));
  }

  return { oneLiner: parts.join('; ') || 'general activity' };
}

// Extract detailed line items for the briefing
function extractDetailedItems(events) {
  var items = [];
  var filesEdited = [];
  var filesRead = [];
  var searches = [];
  var bashCmds = [];
  var failMsgs = [];
  var successMsgs = [];
  var lastToolCall = null;

  events.forEach(function(e) {
    if (e.type === 'tool_call') {
      lastToolCall = e;
      var name = (e.toolName || '').toLowerCase();
      var args = e.toolArgs || {};

      if (name === 'read') {
        var fp = args.file_path || args.filePath || '';
        if (fp) filesRead.push(fp);
      }
      if (name === 'edit') {
        var fp2 = args.file_path || args.filePath || '';
        if (fp2) filesEdited.push(fp2);
      }
      if (name === 'write') {
        var fp3 = args.file_path || args.filePath || '';
        if (fp3) filesEdited.push(fp3);
      }
      if (name === 'websearch' || name === 'web_search') {
        if (args.query) searches.push(String(args.query));
      }
      if (name === 'webfetch' || name === 'web_fetch') {
        if (args.url) searches.push('Fetched ' + shortUrl(String(args.url)));
      }
      if (name === 'bash') {
        var cmd = String(args.command || '');
        if (cmd) bashCmds.push(cmd);
      }
      if (name === 'grep') {
        var pat = args.pattern || '';
        var gpath = args.path || '';
        if (pat) items.push('Searched for <span class="search-ref">\\u201C' + esc(String(pat)) + '\\u201D</span>' + (gpath ? ' in <span class="file-ref">' + esc(shortPath(String(gpath))) + '</span>' : ''));
      }
      if (name === 'glob') {
        var gpat = args.pattern || '';
        if (gpat) items.push('Listed files matching <span class="file-ref">' + esc(String(gpat)) + '</span>');
      }
    }

    if (e.type === 'tool_result' && e.result) {
      var toolName = (e.toolName || '').toLowerCase();
      if (!e.result.success) {
        var preview = e.result.outputPreview || 'unknown error';
        failMsgs.push({ tool: e.toolName || 'unknown', msg: preview });
      }
      // Capture meaningful bash results
      if (toolName === 'bash' && e.result.success && e.result.outputPreview) {
        var prev = e.result.outputPreview;
        if (/pass|success|deployed|built|approved/i.test(prev)) {
          successMsgs.push(prev);
        }
      }
    }
  });

  // Build readable items
  if (filesRead.length > 0) {
    var uniqueRead = Array.from(new Set(filesRead));
    items.push('Read ' + uniqueRead.length + ' file' + (uniqueRead.length > 1 ? 's' : '') + ': ' + uniqueRead.slice(0, 4).map(function(f) { return '<span class="file-ref">' + esc(shortPath(f)) + '</span>'; }).join(', ') + (uniqueRead.length > 4 ? ' +' + (uniqueRead.length - 4) + ' more' : ''));
  }
  if (filesEdited.length > 0) {
    var uniqueEdit = Array.from(new Set(filesEdited));
    items.push('Edited ' + uniqueEdit.length + ' file' + (uniqueEdit.length > 1 ? 's' : '') + ': ' + uniqueEdit.slice(0, 4).map(function(f) { return '<span class="file-ref">' + esc(shortPath(f)) + '</span>'; }).join(', ') + (uniqueEdit.length > 4 ? ' +' + (uniqueEdit.length - 4) + ' more' : ''));
  }
  if (searches.length > 0) {
    searches.forEach(function(q) {
      items.push('Researched: <span class="search-ref">' + esc(truncStr(q, 60)) + '</span>');
    });
  }
  if (bashCmds.length > 0) {
    bashCmds.forEach(function(cmd) {
      items.push('Ran <span class="cmd-ref">' + esc(truncStr(cmd, 50)) + '</span>');
    });
  }
  failMsgs.forEach(function(f) {
    items.push('<span class="fail-ref">\\u2717 ' + esc(f.tool) + ' failed:</span> ' + esc(truncStr(f.msg, 80)));
  });
  successMsgs.forEach(function(m) {
    items.push('<span class="ok-ref">\\u2713</span> ' + esc(truncStr(m, 80)));
  });

  return items.length > 0 ? items : ['General activity'];
}

function shortPath(p) {
  var parts = String(p).split('/');
  if (parts.length <= 3) return p;
  return parts.slice(-3).join('/');
}
function shortUrl(u) {
  try { return new URL(u).hostname + new URL(u).pathname.slice(0, 30); } catch(e) { return u.slice(0, 40); }
}
function truncStr(s, n) { return s.length <= n ? s : s.slice(0, n) + '\\u2026'; }

// ── Timeline rendering ──
function renderTimeline() {
  const container = document.getElementById('timeline');
  if (filteredEvents.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="big">\\uD83D\\uDCD4</div><div>No entries to show.</div></div>';
    return;
  }

  let html = '';
  let lastSession = '';
  let sessionNum = 0;
  filteredEvents.forEach((e, i) => {
    if (e.sessionId !== lastSession) {
      lastSession = e.sessionId;
      sessionNum++;
      html += '<div class="event session-marker">'
        + '<div class="event-dot" style="background:var(--accent);width:14px;height:14px;left:-28px;top:8px"></div>'
        + '<div class="event-content">'
        + '<div class="event-header"><span class="event-tool" style="color:var(--accent);font-style:italic">Session ' + sessionNum + '</span>'
        + '<span class="event-time">' + e.sessionId.slice(0,8) + '</span></div>'
        + '</div></div>';
    }

    const isSelected = i === selectedIdx;
    const tool = e.toolName || e.type;
    const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const color = e._color;
    const icon = e._icon;
    const size = e._size;
    const preview = e.result ? e.result.outputPreview : (e.toolArgs ? JSON.stringify(e.toolArgs).slice(0, 80) : '');
    const costStr = e.tokenUsage ? '$' + e.tokenUsage.estimatedCost.toFixed(4) : '';

    html += '<div class="event' + (isSelected ? ' selected' : '') + '" data-idx="' + i + '" onclick="selectEvent(' + i + ')">';
    html += '<div class="event-dot" style="background:' + color + ';width:' + size + 'px;height:' + size + 'px;left:' + (-(size/2) - 19) + 'px"></div>';
    html += '<div class="event-icon">' + icon + '</div>';
    html += '<div class="event-content">';
    html += '<div class="event-header"><span class="event-tool" style="color:' + color + '">' + esc(tool) + '</span>';
    html += '<span class="event-time">' + time + '</span>';
    html += '<span class="event-type">' + e.type.replace('_', ' ') + '</span></div>';
    if (preview) html += '<div class="event-preview">\u201C' + esc(preview) + '\u201D</div>';
    if (costStr) html += '<div class="event-cost">' + costStr + '</div>';
    html += '</div></div>';
  });

  container.innerHTML = html;
  if (selectedIdx >= 0) {
    const el = container.querySelector('[data-idx="' + selectedIdx + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Detail panel ──
function selectEvent(idx) {
  selectedIdx = idx;
  const e = filteredEvents[idx];
  const panel = document.getElementById('detail');
  const content = document.getElementById('detail-content');
  panel.classList.add('visible');

  let html = '<h2>' + (e._icon || '\\u25CF') + ' ' + esc(e.toolName || e.type) + '</h2>';
  html += '<div class="detail-meta">';
  html += metaItem('Time', new Date(e.timestamp).toLocaleString());
  html += metaItem('Type', e.type);
  if (e.duration) html += metaItem('Duration', (e.duration / 1000).toFixed(1) + 's');
  if (e.model) html += metaItem('Model', e.model);
  if (e.tokenUsage) {
    html += metaItem('Input', e.tokenUsage.input.toLocaleString() + ' tok');
    html += metaItem('Output', e.tokenUsage.output.toLocaleString() + ' tok');
    html += metaItem('Cost', '$' + e.tokenUsage.estimatedCost.toFixed(4));
  }
  html += metaItem('Session', e.sessionId.slice(0, 12));
  html += '</div>';

  if (e.toolArgs && Object.keys(e.toolArgs).length > 0) {
    html += '<div class="detail-section"><h3>Parameters</h3>';
    html += '<pre>' + esc(JSON.stringify(e.toolArgs, null, 2)) + '</pre></div>';
  }
  if (e.result) {
    const st = e.result.success ? '\\u2705 Success' : '\\u274C Failed';
    html += '<div class="detail-section"><h3>Result \\u2014 ' + st + '</h3>';
    html += '<pre>' + esc(e.result.outputPreview) + '</pre></div>';
  }

  content.innerHTML = html;
  renderTimeline();
}

function closeDetail() {
  document.getElementById('detail').classList.remove('visible');
  selectedIdx = -1;
  renderTimeline();
}

function metaItem(label, value) {
  return '<div class="detail-meta-item"><div class="label">' + label + '</div><div class="value">' + esc(String(value)) + '</div></div>';
}

// ── Cost chart ──
function renderCostChart() {
  const canvas = document.getElementById('cost-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);

  let cumCost = 0;
  const points = [];
  EVENTS.forEach((e, i) => {
    if (e.tokenUsage) cumCost += e.tokenUsage.estimatedCost;
    points.push({ x: i, y: cumCost });
  });
  if (points.length === 0) return;
  const maxX = points.length - 1 || 1;
  const maxY = cumCost || 1;
  const w = rect.width;
  const h = rect.height;

  // Fill
  ctx.beginPath();
  ctx.moveTo(0, h);
  points.forEach(p => {
    ctx.lineTo((p.x / maxX) * w, h - (p.y / maxY) * (h - 8) - 4);
  });
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(74,225,104,0.08)';
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#4ae168';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  points.forEach((p, i) => {
    const x = (p.x / maxX) * w;
    const y = h - (p.y / maxY) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  document.getElementById('cost-total-label').textContent = '$' + cumCost.toFixed(2);
}

// ── Filtering ──
function applyFilters() {
  const search = document.getElementById('search').value.toLowerCase();
  const filter = document.getElementById('filter').value;
  filteredEvents = EVENTS.filter(e => {
    if (filter === 'success') return e.type === 'tool_result' && e.result && e.result.success;
    if (filter === 'failure') return e.type === 'tool_result' && e.result && !e.result.success;
    if (filter !== 'all' && e.type !== filter) return false;
    if (search && !JSON.stringify(e).toLowerCase().includes(search)) return false;
    return true;
  });
  selectedIdx = -1;
  renderTimeline();
}
document.getElementById('search').addEventListener('input', applyFilters);
document.getElementById('filter').addEventListener('change', applyFilters);

// ── Replay with floating FAB ──
function stopReplay() {
  if (replayInterval) clearInterval(replayInterval);
  replayInterval = null;
  document.getElementById('replay').classList.remove('active');
  document.getElementById('replay').textContent = '\\u25B6 Replay';
  document.getElementById('replay-fab').classList.remove('visible');
  document.getElementById('fab-icon').textContent = '\\u23F8';
  updateFabProgress();
}

function startReplay() {
  document.getElementById('replay').classList.add('active');
  document.getElementById('replay').textContent = '\\u23F8 Pause';
  document.getElementById('replay-fab').classList.add('visible');
  document.getElementById('fab-icon').textContent = '\\u23F8';
  selectedIdx = -1;
  replayInterval = setInterval(function() {
    selectedIdx++;
    if (selectedIdx >= filteredEvents.length) {
      stopReplay();
      return;
    }
    selectEvent(selectedIdx);
    updateFabProgress();
  }, 600);
}

function pauseReplay() {
  if (replayInterval) clearInterval(replayInterval);
  replayInterval = null;
  document.getElementById('replay').classList.remove('active');
  document.getElementById('replay').textContent = '\\u25B6 Resume';
  document.getElementById('fab-icon').textContent = '\\u25B6';
}

function resumeReplay() {
  document.getElementById('replay').classList.add('active');
  document.getElementById('replay').textContent = '\\u23F8 Pause';
  document.getElementById('fab-icon').textContent = '\\u23F8';
  replayInterval = setInterval(function() {
    selectedIdx++;
    if (selectedIdx >= filteredEvents.length) {
      stopReplay();
      return;
    }
    selectEvent(selectedIdx);
    updateFabProgress();
  }, 600);
}

function updateFabProgress() {
  var total = filteredEvents.length || 1;
  var current = Math.max(selectedIdx + 1, 0);
  var pct = current / total;
  var circumference = 164;
  var ring = document.getElementById('fab-ring');
  if (ring) ring.style.strokeDashoffset = String(circumference - pct * circumference);
  var counter = document.getElementById('fab-counter');
  if (counter) counter.textContent = current + '/' + total;
}

// Called by floating FAB onclick
function toggleReplay() {
  if (replayInterval) {
    pauseReplay();
  } else if (selectedIdx >= 0 && selectedIdx < filteredEvents.length - 1) {
    resumeReplay();
  } else {
    startReplay();
  }
}

// Controls-bar replay button
document.getElementById('replay').addEventListener('click', function() {
  if (replayInterval) {
    pauseReplay();
  } else if (selectedIdx >= 0 && selectedIdx < filteredEvents.length - 1) {
    resumeReplay();
  } else {
    startReplay();
  }
});

// close detail on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// ── Init ──
generateNarrative();
renderTimeline();
renderCostChart();
window.addEventListener('resize', renderCostChart);
</script>
</body>
</html>`;
}

// ── CLI ──

function main(): void {
  const arg = process.argv[2];
  let events: DiaryEvent[];
  let title: string;

  if (arg === 'week') {
    events = loadEventsForDays(7);
    title = 'This Week';
  } else if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    const date = new Date(arg + 'T00:00:00');
    events = loadEventsForDate(date);
    title = arg;
  } else {
    events = loadEventsForDate(new Date());
    const today = getDateFileName(new Date()).replace('.jsonl', '');
    title = today;
  }

  const html = generateTimelineHtml(events, title);
  const outDir = join(getDataDir(), 'output');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'timeline.html');
  writeFileSync(outFile, html);
  console.log(outFile);
}

// Only run CLI when executed directly, not when imported
const isMain = process.argv[1]?.endsWith('timeline.js');
if (isMain) main();

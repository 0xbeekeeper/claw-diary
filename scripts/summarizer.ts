#!/usr/bin/env node
/**
 * claw-diary summarizer
 *
 * Reads JSONL events and generates narrative diary summaries.
 * Usage:
 *   node summarizer.js today          — Generate today's diary
 *   node summarizer.js week           — Generate this week's summary
 *   node summarizer.js date YYYY-MM-DD — Generate diary for a specific date
 */

import { DiaryEvent, SessionSummary, DiarySummary, getDateFileName, loadEventsForDate, formatDuration, formatCost, formatTokens } from './types.js';


// ── Session grouping ──

function groupBySession(events: DiaryEvent[]): Map<string, DiaryEvent[]> {
  const sessions = new Map<string, DiaryEvent[]>();
  for (const event of events) {
    const existing = sessions.get(event.sessionId) || [];
    existing.push(event);
    sessions.set(event.sessionId, existing);
  }
  return sessions;
}

// ── Session summarization ──

function summarizeSession(sessionId: string, events: DiaryEvent[]): SessionSummary {
  const sorted = events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const startTime = sorted[0]?.timestamp || new Date().toISOString();
  const endTime = sorted[sorted.length - 1]?.timestamp || startTime;

  const toolCalls = events.filter(e => e.type === 'tool_call');
  const toolResults = events.filter(e => e.type === 'tool_result');
  const failures = toolResults.filter(e => e.result && !e.result.success);

  // Count tools
  const toolCounts = new Map<string, number>();
  for (const tc of toolCalls) {
    if (tc.toolName) {
      toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
    }
  }
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Calculate tokens and cost
  let tokens = 0;
  let cost = 0;
  for (const e of events) {
    if (e.tokenUsage) {
      tokens += e.tokenUsage.input + e.tokenUsage.output;
      cost += e.tokenUsage.estimatedCost;
    }
  }

  // Calculate duration
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

  // Generate description
  const description = generateSessionDescription(toolCalls, toolResults, topTools, failures.length);

  return {
    sessionId,
    startTime,
    endTime,
    duration: durationMs,
    toolCalls: toolCalls.length,
    tokens,
    cost,
    topTools,
    failures: failures.length,
    description,
  };
}

function generateSessionDescription(
  toolCalls: DiaryEvent[],
  toolResults: DiaryEvent[],
  topTools: { name: string; count: number }[],
  failureCount: number,
): string {
  const parts: string[] = [];

  // Determine primary activity based on tools used
  const toolNames = topTools.map(t => t.name.toLowerCase());

  if (toolNames.some(t => t.includes('read') || t.includes('glob') || t.includes('grep'))) {
    parts.push('explored and read code files');
  }
  if (toolNames.some(t => t.includes('edit') || t.includes('write'))) {
    parts.push('wrote and edited files');
  }
  if (toolNames.some(t => t.includes('bash'))) {
    parts.push('ran shell commands');
  }
  if (toolNames.some(t => t.includes('web') || t.includes('search'))) {
    parts.push('did web research');
  }
  if (toolNames.some(t => t.includes('lsp'))) {
    parts.push('used code intelligence');
  }
  if (toolNames.some(t => t.includes('task'))) {
    parts.push('dispatched sub-agents');
  }

  if (parts.length === 0) {
    parts.push(`used ${topTools.map(t => t.name).join(', ')}`);
  }

  let desc = `Made ${toolCalls.length} tool calls. Primarily ${parts.join(', ')}.`;
  if (failureCount > 0) {
    desc += ` Encountered ${failureCount} failure${failureCount > 1 ? 's' : ''}.`;
  }
  return desc;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Daily diary generation ──

export function generateDailySummary(date: Date): DiarySummary {
  const events = loadEventsForDate(date);
  const dateStr = getDateFileName(date).replace('.jsonl', '');

  if (events.length === 0) {
    return {
      date: dateStr,
      totalSessions: 0,
      totalDuration: 0,
      totalTokens: 0,
      totalCost: 0,
      sessions: [],
      insights: ['No agent activity recorded today.'],
      markdown: `# ${dateStr} Agent Diary\n\nNo activity recorded today. Take a break! 🌴\n`,
    };
  }

  const sessionMap = groupBySession(events);
  const sessions = [...sessionMap.entries()].map(([id, evts]) => summarizeSession(id, evts));
  sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolCalls, 0);
  const totalFailures = sessions.reduce((sum, s) => sum + s.failures, 0);

  // Generate insights
  const insights = generateInsights(sessions, events, totalToolCalls, totalFailures);

  // Generate markdown
  const md = generateDiaryMarkdown(dateStr, sessions, totalDuration, totalTokens, totalCost, totalToolCalls, insights);

  return {
    date: dateStr,
    totalSessions: sessions.length,
    totalDuration,
    totalTokens,
    totalCost,
    sessions,
    insights,
    markdown: md,
  };
}

function generateInsights(
  sessions: SessionSummary[],
  events: DiaryEvent[],
  totalToolCalls: number,
  totalFailures: number,
): string[] {
  const insights: string[] = [];

  // Failure rate insight
  if (totalToolCalls > 0) {
    const failRate = (totalFailures / totalToolCalls) * 100;
    if (failRate > 20) {
      insights.push(`High failure rate today (${failRate.toFixed(0)}%). Consider running tests before making changes.`);
    } else if (failRate === 0 && totalToolCalls > 10) {
      insights.push(`Perfect run today — zero failures across ${totalToolCalls} tool calls!`);
    }
  }

  // Most used tools
  const allToolCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_call' && e.toolName) {
      allToolCounts.set(e.toolName, (allToolCounts.get(e.toolName) || 0) + 1);
    }
  }
  const topTool = [...allToolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTool && topTool[1] > 5) {
    insights.push(`Most used tool today: ${topTool[0]} (${topTool[1]} times).`);
  }

  // Session pattern
  if (sessions.length >= 3) {
    insights.push(`Productive day with ${sessions.length} sessions. You're on a roll!`);
  }

  // Cost insight
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  if (totalCost > 5) {
    insights.push(`Spent ${formatCost(totalCost)} today — consider using lighter models for simple tasks.`);
  }

  // Read-heavy vs write-heavy
  const readOps = events.filter(e => e.type === 'tool_call' && e.toolName && (e.toolName.toLowerCase().includes('read') || e.toolName.toLowerCase().includes('grep') || e.toolName.toLowerCase().includes('glob'))).length;
  const writeOps = events.filter(e => e.type === 'tool_call' && e.toolName && (e.toolName.toLowerCase().includes('edit') || e.toolName.toLowerCase().includes('write'))).length;
  if (readOps > writeOps * 3 && readOps > 10) {
    insights.push(`Research-heavy day: ${readOps} reads vs ${writeOps} writes. Lots of exploration!`);
  } else if (writeOps > readOps && writeOps > 5) {
    insights.push(`Writing-heavy day: ${writeOps} writes vs ${readOps} reads. Ship it!`);
  }

  return insights.length > 0 ? insights : ['Another day of steady agent activity.'];
}

function generateDiaryMarkdown(
  dateStr: string,
  sessions: SessionSummary[],
  totalDuration: number,
  totalTokens: number,
  totalCost: number,
  totalToolCalls: number,
  insights: string[],
): string {
  const lines: string[] = [];

  lines.push(`# ${dateStr} Agent Diary`);
  lines.push('');
  lines.push('## Overview');
  lines.push(`Today: **${sessions.length}** session${sessions.length !== 1 ? 's' : ''}, **${formatDuration(totalDuration)}** total, **${formatTokens(totalTokens)}** tokens (**${formatCost(totalCost)}**), **${totalToolCalls}** tool calls.`);
  lines.push('');

  lines.push('## Timeline');
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    lines.push(`### Session ${i + 1} (${formatTime(s.startTime)} – ${formatTime(s.endTime)})${s.topTools.length > 0 ? ' — ' + categorizeSession(s) : ''}`);
    lines.push(s.description);
    lines.push(`> ${formatTokens(s.tokens)} tokens (${formatCost(s.cost)}) | ${formatDuration(s.duration)}`);
    if (s.topTools.length > 0) {
      lines.push(`> Tools: ${s.topTools.map(t => `${t.name}×${t.count}`).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Insights');
  for (const insight of insights) {
    lines.push(`- ${insight}`);
  }
  lines.push('');

  return lines.join('\n');
}

function categorizeSession(session: SessionSummary): string {
  const tools = session.topTools.map(t => t.name.toLowerCase());
  if (tools.some(t => t.includes('edit') || t.includes('write'))) {
    if (tools.some(t => t.includes('bash'))) return 'Coding & Testing';
    return 'Code Editing';
  }
  if (tools.some(t => t.includes('web') || t.includes('search'))) return 'Research';
  if (tools.some(t => t.includes('read') || t.includes('grep') || t.includes('glob'))) return 'Code Review';
  if (tools.some(t => t.includes('bash'))) return 'Shell Operations';
  return 'Mixed Activity';
}

// ── Weekly summary ──

export function generateWeeklySummary(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);

  const dailySummaries: DiarySummary[] = [];
  const current = new Date(monday);
  while (current <= today) {
    dailySummaries.push(generateDailySummary(current));
    current.setDate(current.getDate() + 1);
  }

  const totalSessions = dailySummaries.reduce((s, d) => s + d.totalSessions, 0);
  const totalTokens = dailySummaries.reduce((s, d) => s + d.totalTokens, 0);
  const totalCost = dailySummaries.reduce((s, d) => s + d.totalCost, 0);
  const totalDuration = dailySummaries.reduce((s, d) => s + d.totalDuration, 0);

  const lines: string[] = [];
  const weekStart = getDateFileName(monday).replace('.jsonl', '');
  const weekEnd = getDateFileName(today).replace('.jsonl', '');

  lines.push(`# Weekly Report: ${weekStart} → ${weekEnd}`);
  lines.push('');
  lines.push('## Weekly Overview');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Sessions | ${totalSessions} |`);
  lines.push(`| Total Time | ${formatDuration(totalDuration)} |`);
  lines.push(`| Total Tokens | ${formatTokens(totalTokens)} |`);
  lines.push(`| Total Cost | ${formatCost(totalCost)} |`);
  lines.push(`| Avg Cost/Day | ${formatCost(totalCost / Math.max(dailySummaries.length, 1))} |`);
  lines.push('');

  lines.push('## Daily Breakdown');
  lines.push('| Date | Sessions | Duration | Tokens | Cost |');
  lines.push('|------|----------|----------|--------|------|');
  for (const d of dailySummaries) {
    lines.push(`| ${d.date} | ${d.totalSessions} | ${formatDuration(d.totalDuration)} | ${formatTokens(d.totalTokens)} | ${formatCost(d.totalCost)} |`);
  }
  lines.push('');

  // Aggregate insights
  const allInsights = dailySummaries.flatMap(d => d.insights).filter(i => i !== 'No agent activity recorded today.' && i !== 'Another day of steady agent activity.');
  if (allInsights.length > 0) {
    lines.push('## Weekly Insights');
    const unique = [...new Set(allInsights)].slice(0, 8);
    for (const insight of unique) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── CLI entry point ──

function main(): void {
  const command = process.argv[2] || 'today';

  switch (command) {
    case 'today': {
      const summary = generateDailySummary(new Date());
      console.log(summary.markdown);
      break;
    }

    case 'week': {
      const weeklyMd = generateWeeklySummary();
      console.log(weeklyMd);
      break;
    }

    case 'date': {
      const dateArg = process.argv[3];
      if (!dateArg) {
        console.error('Usage: summarizer.js date YYYY-MM-DD');
        process.exit(1);
      }
      const date = new Date(dateArg + 'T00:00:00');
      if (isNaN(date.getTime())) {
        console.error(`Invalid date: ${dateArg}`);
        process.exit(1);
      }
      const summary = generateDailySummary(date);
      console.log(summary.markdown);
      break;
    }

    case 'json': {
      const summary = generateDailySummary(new Date());
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: summarizer.js <today|week|date YYYY-MM-DD|json>');
      process.exit(1);
  }
}

const isMain = process.argv[1]?.endsWith('summarizer.js');
if (isMain) main();

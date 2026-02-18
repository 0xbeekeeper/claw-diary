#!/usr/bin/env node
/**
 * claw-diary local HTTP server
 *
 * Serves the timeline visualization and reports.
 * Usage: node server.js [port]
 *
 * Routes:
 *   /           — Interactive timeline (today)
 *   /timeline   — Timeline (supports ?date=YYYY-MM-DD and ?range=week)
 *   /report     — Daily report (supports ?date=YYYY-MM-DD)
 *   /weekly     — Weekly report
 *   /api/events — Raw events JSON (supports ?date=YYYY-MM-DD)
 *   /api/stats  — Analytics JSON
 */

import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { DiaryEvent, getEventsDir, getDataDir, getDateFileName, loadEventsForDate, loadEventsForDays, formatTokens } from './types.js';
import { generateTimelineHtml } from './timeline.js';
import { generateWeeklySummary } from './summarizer.js';
import { generateStats } from './analytics.js';

const DEFAULT_PORT = 3847;

function generateReportHtml(dateStr: string, events: DiaryEvent[]): string {
  const sessions = new Set(events.map(e => e.sessionId)).size;
  const toolCalls = events.filter(e => e.type === 'tool_call').length;
  let totalCost = 0, totalTokens = 0;
  events.forEach(e => {
    if (e.tokenUsage) {
      totalCost += e.tokenUsage.estimatedCost;
      totalTokens += e.tokenUsage.input + e.tokenUsage.output;
    }
  });

  const toolCounts: Record<string, number> = {};
  events.filter(e => e.type === 'tool_call' && e.toolName).forEach(e => {
    toolCounts[e.toolName!] = (toolCounts[e.toolName!] || 0) + 1;
  });
  const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Hourly activity heatmap data
  const hourlyActivity = new Array(24).fill(0);
  events.filter(e => e.type === 'tool_call').forEach(e => {
    const hour = new Date(e.timestamp).getHours();
    hourlyActivity[hour]++;
  });
  const maxHourly = Math.max(...hourlyActivity, 1);

  // Build dynamic HTML parts outside the main template literal
  const heatmapCells = hourlyActivity.map((count: number, hour: number) => {
    const intensity = count / maxHourly;
    const bg = count === 0 ? 'var(--surface)' : 'rgba(56,166,255,' + (0.15 + intensity * 0.85).toFixed(2) + ')';
    return '<div class="heatmap-cell" style="background:' + bg + '" title="' + hour + ':00 — ' + count + ' calls">' + hour + '</div>';
  }).join('\n');

  const toolRows = topTools.map(([name, count]: [string, number]) => {
    const pct = (count / Math.max(toolCalls, 1)) * 100;
    return '<tr><td>' + name + '</td><td>' + count + '</td><td><span class="bar" style="width:' + Math.max(pct, 2) + '%"></span></td></tr>';
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${dateStr} Report — Claw Diary</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --amber: #d29922;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }
  h2 { font-size: 16px; color: var(--text-muted); margin: 24px 0 12px; text-transform: uppercase; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card .value { font-size: 28px; font-weight: 700; color: var(--accent); }
  .card .label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--text-muted); font-weight: 600; }
  .bar { height: 16px; border-radius: 3px; background: var(--accent); display: inline-block; vertical-align: middle; min-width: 2px; }
  .heatmap { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 24px; }
  .heatmap-cell { width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-muted); }
  .nav { margin-bottom: 16px; }
  .nav a { color: var(--accent); text-decoration: none; margin-right: 16px; font-size: 13px; }
  .nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="nav">
  <a href="/">← Timeline</a>
  <a href="/weekly">Weekly Report</a>
</div>
<h1>${dateStr} — Daily Report</h1>

<div class="cards">
  <div class="card"><div class="value">${sessions}</div><div class="label">Sessions</div></div>
  <div class="card"><div class="value">${toolCalls}</div><div class="label">Tool Calls</div></div>
  <div class="card"><div class="value">${formatTokens(totalTokens)}</div><div class="label">Tokens</div></div>
  <div class="card"><div class="value">$${totalCost.toFixed(2)}</div><div class="label">Cost</div></div>
</div>

<h2>Hourly Activity</h2>
<div class="heatmap">
${heatmapCells}
</div>

<h2>Top Tools</h2>
<table>
<tr><th>Tool</th><th>Calls</th><th></th></tr>
${toolRows}
</table>

</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateWeeklyReportHtml(markdown: string): string {
  // Convert markdown to simple HTML
  const lines = markdown.split('\n');
  let bodyHtml = '';
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith('# ')) {
      bodyHtml += `<h1>${escapeHtml(line.slice(2))}</h1>\n`;
    } else if (line.startsWith('## ')) {
      bodyHtml += `<h2>${escapeHtml(line.slice(3))}</h2>\n`;
    } else if (line.startsWith('- ')) {
      bodyHtml += `<div class="insight">${escapeHtml(line.slice(2))}</div>\n`;
    } else if (line.startsWith('|') && line.includes('---')) {
      // Skip separator rows
    } else if (line.startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (!inTable) {
        bodyHtml += '<table><thead><tr>';
        cells.forEach(c => { bodyHtml += `<th>${escapeHtml(c)}</th>`; });
        bodyHtml += '</tr></thead><tbody>\n';
        inTable = true;
      } else {
        bodyHtml += '<tr>';
        cells.forEach(c => { bodyHtml += `<td>${escapeHtml(c)}</td>`; });
        bodyHtml += '</tr>\n';
      }
    } else {
      if (inTable) {
        bodyHtml += '</tbody></table>\n';
        inTable = false;
      }
    }
  }
  if (inTable) bodyHtml += '</tbody></table>\n';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Weekly Report — Claw Diary</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --amber: #d29922;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 24px; color: var(--accent); }
  h2 { font-size: 16px; color: var(--text-muted); margin: 24px 0 12px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--text-muted); font-weight: 600; background: var(--surface); }
  td { color: var(--text); }
  .insight { padding: 6px 12px; margin: 4px 0; background: var(--surface); border-left: 3px solid var(--accent); border-radius: 4px; font-size: 13px; }
  .nav { margin-bottom: 16px; }
  .nav a { color: var(--accent); text-decoration: none; margin-right: 16px; font-size: 13px; }
  .nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="nav">
  <a href="/">← Timeline</a>
  <a href="/report">Daily Report</a>
</div>
${bodyHtml}
</body></html>`;
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execSync(`open "${url}"`);
    else if (platform === 'win32') execSync(`start "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch {
    // Silently fail if browser can't be opened
  }
}

function main(): void {
  const port = parseInt(process.argv[2] || '', 10) || DEFAULT_PORT;

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/' || pathname === '/timeline') {
        const dateParam = url.searchParams.get('date');
        const range = url.searchParams.get('range');
        let events: DiaryEvent[];
        let title: string;

        if (range === 'week') {
          events = loadEventsForDays(7);
          title = 'This Week\'s Timeline';
        } else if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          const date = new Date(dateParam + 'T00:00:00');
          events = loadEventsForDate(date);
          title = `${dateParam} Timeline`;
        } else {
          events = loadEventsForDate(new Date());
          const today = getDateFileName(new Date()).replace('.jsonl', '');
          title = `${today} Timeline`;
        }

        const html = generateTimelineHtml(events, title);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (pathname === '/report') {
        const dateParam = url.searchParams.get('date');
        const date = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
        const dateStr = getDateFileName(date).replace('.jsonl', '');
        const events = loadEventsForDate(date);
        const html = generateReportHtml(dateStr, events);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (pathname === '/weekly') {
        const weeklyMd = generateWeeklySummary();
        const html = generateWeeklyReportHtml(weeklyMd);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (pathname === '/api/events') {
        const dateParam = url.searchParams.get('date');
        const date = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
        const events = loadEventsForDate(date);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events, null, 2));
        return;
      }

      if (pathname === '/api/stats') {
        const stats = generateStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
        return;
      }

      // Available dates list
      if (pathname === '/api/dates') {
        const dir = getEventsDir();
        const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort() : [];
        const dates = files.map(f => f.replace('.jsonl', ''));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dates));
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');

    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Claw Diary server running at ${url}`);
    console.log(`  Timeline:  ${url}/`);
    console.log(`  Report:    ${url}/report`);
    console.log(`  Weekly:    ${url}/weekly`);
    console.log(`  API:       ${url}/api/events`);
    openBrowser(url);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });
}

const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) main();

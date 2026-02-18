#!/usr/bin/env node
/**
 * claw-diary analytics engine
 *
 * Cost analysis, activity stats, pattern discovery, search, and export.
 * Usage:
 *   node analytics.js stats             — Show cost & activity stats
 *   node analytics.js search <query>    — Search historical events
 *   node analytics.js export [format]   — Export data (md|html|json)
 *   node analytics.js clear             — Delete all data
 */
import { readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getEventsDir, getDataDir, getDateFileName, loadEventsForDate, formatDuration, formatCost } from './types.js';
import { generateTimelineHtml } from './timeline.js';
import { generateDailySummary } from './summarizer.js';
// ── Event loading ──
function loadAllEvents() {
    const dir = getEventsDir();
    if (!existsSync(dir))
        return [];
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
    const events = [];
    for (const file of files) {
        const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                events.push(JSON.parse(line));
            }
            catch { /* skip */ }
        }
    }
    return events;
}
// ── Stats generation ──
export function generateStats() {
    // Load 30 days of data once into a cache
    const dayCache = new Map();
    const today = new Date();
    for (let i = 0; i < 30; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const key = getDateFileName(date).replace('.jsonl', '');
        dayCache.set(key, loadEventsForDate(date));
    }
    const todayKey = getDateFileName(today).replace('.jsonl', '');
    const todayEvents = dayCache.get(todayKey) || [];
    // Week events: last 7 days
    const weekEvents = [];
    const monthEvents = [];
    let dayIdx = 0;
    for (const [, events] of dayCache) {
        monthEvents.push(...events);
        if (dayIdx < 7)
            weekEvents.push(...events);
        dayIdx++;
    }
    // Cost calculations
    const dailyCost = sumCost(todayEvents);
    const weeklyCost = sumCost(weekEvents);
    const costByModel = {};
    const costByToolType = {};
    for (const e of monthEvents) {
        if (e.tokenUsage) {
            const model = e.model || 'unknown';
            costByModel[model] = (costByModel[model] || 0) + e.tokenUsage.estimatedCost;
        }
        if (e.type === 'tool_result' && e.toolName && e.tokenUsage) {
            costByToolType[e.toolName] = (costByToolType[e.toolName] || 0) + e.tokenUsage.estimatedCost;
        }
    }
    // Cost trend (past 30 days) — from cache
    const costTrend = [];
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateStr = getDateFileName(date).replace('.jsonl', '');
        const dayEvents = dayCache.get(dateStr) || [];
        costTrend.push({ date: dateStr, cost: sumCost(dayEvents) });
    }
    // Activity stats
    const allSessions = new Set(monthEvents.map(e => e.sessionId));
    const toolCalls = monthEvents.filter(e => e.type === 'tool_call');
    const toolResults = monthEvents.filter(e => e.type === 'tool_result');
    const failures = toolResults.filter(e => e.result && !e.result.success);
    // Session durations
    const sessionStarts = monthEvents.filter(e => e.type === 'session_start');
    const sessionEnds = monthEvents.filter(e => e.type === 'session_end');
    let totalSessionDuration = 0;
    let sessionCount = 0;
    for (const end of sessionEnds) {
        if (end.duration) {
            totalSessionDuration += end.duration;
            sessionCount++;
        }
    }
    const avgSessionDuration = sessionCount > 0 ? totalSessionDuration / sessionCount : 0;
    // Top tools
    const toolCountMap = new Map();
    for (const e of monthEvents) {
        if (e.type === 'tool_call' && e.toolName) {
            const existing = toolCountMap.get(e.toolName) || { count: 0, cost: 0 };
            existing.count++;
            toolCountMap.set(e.toolName, existing);
        }
        if (e.type === 'tool_result' && e.toolName && e.tokenUsage) {
            const existing = toolCountMap.get(e.toolName) || { count: 0, cost: 0 };
            existing.cost += e.tokenUsage.estimatedCost;
            toolCountMap.set(e.toolName, existing);
        }
    }
    const topTools = [...toolCountMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([name, data]) => ({ name, count: data.count, cost: data.cost }));
    const failureRate = toolResults.length > 0 ? failures.length / toolResults.length : 0;
    // Pattern discovery
    const patterns = discoverPatterns(monthEvents, costTrend);
    return {
        dailyCost,
        weeklyCost,
        costByModel,
        costByToolType,
        costTrend,
        totalSessions: allSessions.size,
        totalToolCalls: toolCalls.length,
        avgSessionDuration,
        topTools,
        failureRate,
        patterns,
    };
}
function sumCost(events) {
    return events.reduce((sum, e) => sum + (e.tokenUsage?.estimatedCost || 0), 0);
}
// ── Pattern discovery ──
function discoverPatterns(events, costTrend) {
    const patterns = [];
    // Day-of-week patterns
    const dayActivity = new Map();
    for (const e of events) {
        if (e.type === 'tool_call') {
            const day = new Date(e.timestamp).getDay();
            dayActivity.set(day, (dayActivity.get(day) || 0) + 1);
        }
    }
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const busiestDay = [...dayActivity.entries()].sort((a, b) => b[1] - a[1])[0];
    if (busiestDay && busiestDay[1] > 10) {
        patterns.push({
            description: `${dayNames[busiestDay[0]]} is your busiest day (${busiestDay[1]} tool calls this month).`,
            confidence: 0.7,
        });
    }
    // Cost trend
    const recentCosts = costTrend.slice(-7).map(c => c.cost);
    const olderCosts = costTrend.slice(-14, -7).map(c => c.cost);
    const recentAvg = recentCosts.reduce((a, b) => a + b, 0) / Math.max(recentCosts.length, 1);
    const olderAvg = olderCosts.reduce((a, b) => a + b, 0) / Math.max(olderCosts.length, 1);
    if (olderAvg > 0) {
        const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
        if (changePercent > 20) {
            patterns.push({
                description: `Costs trending up ${changePercent.toFixed(0)}% vs last week.`,
                confidence: 0.6,
                suggestion: 'Consider using lighter models for routine tasks.',
            });
        }
        else if (changePercent < -20) {
            patterns.push({
                description: `Costs trending down ${Math.abs(changePercent).toFixed(0)}% vs last week. Nice!`,
                confidence: 0.6,
            });
        }
    }
    // Repeated tool patterns
    const toolSequences = new Map();
    const toolCallEvents = events.filter(e => e.type === 'tool_call' && e.toolName);
    for (let i = 0; i < toolCallEvents.length - 1; i++) {
        const pair = `${toolCallEvents[i].toolName} → ${toolCallEvents[i + 1].toolName}`;
        toolSequences.set(pair, (toolSequences.get(pair) || 0) + 1);
    }
    const topSequence = [...toolSequences.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topSequence && topSequence[1] > 15) {
        patterns.push({
            description: `Common workflow pattern: ${topSequence[0]} (${topSequence[1]} times).`,
            confidence: 0.8,
        });
    }
    // Time-of-day pattern
    const hourActivity = new Map();
    for (const e of events) {
        if (e.type === 'tool_call') {
            const hour = new Date(e.timestamp).getHours();
            hourActivity.set(hour, (hourActivity.get(hour) || 0) + 1);
        }
    }
    const peakHour = [...hourActivity.entries()].sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
        patterns.push({
            description: `Peak activity hour: ${peakHour[0]}:00–${peakHour[0] + 1}:00 (${peakHour[1]} tool calls).`,
            confidence: 0.7,
        });
    }
    // Failure pattern
    const failedTools = new Map();
    for (const e of events) {
        if (e.type === 'tool_result' && e.result && !e.result.success && e.toolName) {
            failedTools.set(e.toolName, (failedTools.get(e.toolName) || 0) + 1);
        }
    }
    const mostFailed = [...failedTools.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mostFailed && mostFailed[1] > 5) {
        patterns.push({
            description: `${mostFailed[0]} has the highest failure rate (${mostFailed[1]} failures this month).`,
            confidence: 0.8,
            suggestion: `Review how ${mostFailed[0]} is being called — may need parameter adjustments.`,
        });
    }
    return patterns;
}
// ── Search ──
function searchEvents(query) {
    const allEvents = loadAllEvents();
    const lowerQuery = query.toLowerCase();
    return allEvents.filter(e => {
        const searchable = JSON.stringify(e).toLowerCase();
        return searchable.includes(lowerQuery);
    });
}
// ── Export ──
function exportData(format) {
    const outDir = join(getDataDir(), 'exports');
    mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    switch (format) {
        case 'json': {
            const events = loadAllEvents();
            const outFile = join(outDir, `diary-export-${timestamp}.json`);
            writeFileSync(outFile, JSON.stringify(events, null, 2));
            console.log(`Exported ${events.length} events to ${outFile}`);
            break;
        }
        case 'html': {
            const allEvents = loadAllEvents();
            const html = generateTimelineHtml(allEvents, 'Diary Export');
            const outFile = join(outDir, `diary-export-${timestamp}.html`);
            writeFileSync(outFile, html);
            console.log(`Exported ${allEvents.length} events to ${outFile}`);
            break;
        }
        case 'md':
        default: {
            const dir = getEventsDir();
            if (!existsSync(dir)) {
                console.log('No data to export.');
                return;
            }
            const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
            const sections = ['# Claw Diary Export', ''];
            for (const file of files) {
                const dateStr = basename(file, '.jsonl');
                const date = new Date(dateStr + 'T00:00:00');
                const summary = generateDailySummary(date);
                sections.push(summary.markdown);
                sections.push('---\n');
            }
            const outFile = join(outDir, `diary-export-${timestamp}.md`);
            writeFileSync(outFile, sections.join('\n'));
            console.log(`Exported to ${outFile}`);
            break;
        }
    }
}
// ── Clear ──
function clearData(confirmed) {
    if (!confirmed) {
        console.log('⚠️  This will permanently delete ALL claw-diary data in ~/.claw-diary/');
        console.log('   Run with --yes flag to confirm: analytics.js clear --yes');
        return;
    }
    const dataDir = getDataDir();
    if (existsSync(dataDir)) {
        rmSync(dataDir, { recursive: true, force: true });
        console.log('All claw-diary data has been deleted.');
    }
    else {
        console.log('No data to clear.');
    }
}
function printStats() {
    const stats = generateStats();
    console.log('# Claw Diary — Stats & Analytics');
    console.log('');
    console.log('## Cost Summary');
    console.log(`| Period | Cost |`);
    console.log(`|--------|------|`);
    console.log(`| Today | ${formatCost(stats.dailyCost)} |`);
    console.log(`| This Week | ${formatCost(stats.weeklyCost)} |`);
    console.log('');
    if (Object.keys(stats.costByModel).length > 0) {
        console.log('## Cost by Model (30 days)');
        console.log('| Model | Cost |');
        console.log('|-------|------|');
        for (const [model, cost] of Object.entries(stats.costByModel).sort((a, b) => b[1] - a[1])) {
            console.log(`| ${model} | ${formatCost(cost)} |`);
        }
        console.log('');
    }
    console.log('## Activity (30 days)');
    console.log(`| Metric | Value |`);
    console.log(`|--------|-------|`);
    console.log(`| Sessions | ${stats.totalSessions} |`);
    console.log(`| Tool Calls | ${stats.totalToolCalls} |`);
    console.log(`| Avg Session | ${formatDuration(stats.avgSessionDuration)} |`);
    console.log(`| Failure Rate | ${(stats.failureRate * 100).toFixed(1)}% |`);
    console.log('');
    if (stats.topTools.length > 0) {
        console.log('## Top Tools (30 days)');
        console.log('| Tool | Calls | Cost |');
        console.log('|------|-------|------|');
        for (const tool of stats.topTools) {
            console.log(`| ${tool.name} | ${tool.count} | ${formatCost(tool.cost)} |`);
        }
        console.log('');
    }
    if (stats.patterns.length > 0) {
        console.log('## Discovered Patterns');
        for (const p of stats.patterns) {
            const confidence = p.confidence >= 0.8 ? '🟢' : p.confidence >= 0.6 ? '🟡' : '⚪';
            console.log(`- ${confidence} ${p.description}`);
            if (p.suggestion) {
                console.log(`  → ${p.suggestion}`);
            }
        }
        console.log('');
    }
    // Mini sparkline of cost trend
    if (stats.costTrend.length > 0) {
        console.log('## 30-Day Cost Trend');
        const maxCost = Math.max(...stats.costTrend.map(c => c.cost), 0.01);
        const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
        const spark = stats.costTrend.map(c => {
            const idx = Math.min(Math.floor((c.cost / maxCost) * 7), 7);
            return sparkChars[idx];
        }).join('');
        console.log(`\`${spark}\``);
        console.log(`Range: ${formatCost(Math.min(...stats.costTrend.map(c => c.cost)))} – ${formatCost(maxCost)}`);
        console.log('');
    }
}
function printSearch(query) {
    const results = searchEvents(query);
    if (results.length === 0) {
        console.log(`No events matching "${query}".`);
        return;
    }
    console.log(`# Search Results: "${query}" (${results.length} matches)`);
    console.log('');
    const shown = results.slice(-20); // Show last 20
    if (results.length > 20) {
        console.log(`Showing last 20 of ${results.length} matches.`);
        console.log('');
    }
    for (const e of shown) {
        const time = new Date(e.timestamp).toLocaleString();
        const tool = e.toolName || e.type;
        const preview = e.result?.outputPreview || '';
        console.log(`**${time}** | \`${tool}\` | ${e.type}`);
        if (preview)
            console.log(`  ${preview.slice(0, 100)}`);
        console.log('');
    }
}
// ── CLI entry point ──
function main() {
    const command = process.argv[2] || 'stats';
    switch (command) {
        case 'stats':
            printStats();
            break;
        case 'search': {
            const query = process.argv.slice(3).join(' ');
            if (!query) {
                console.error('Usage: analytics.js search <query>');
                process.exit(1);
            }
            printSearch(query);
            break;
        }
        case 'export': {
            const format = process.argv[3] || 'md';
            exportData(format);
            break;
        }
        case 'clear': {
            const confirmed = process.argv.includes('--yes');
            clearData(confirmed);
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Usage: analytics.js <stats|search|export|clear>');
            process.exit(1);
    }
}
const isMain = process.argv[1]?.endsWith('analytics.js');
if (isMain)
    main();
//# sourceMappingURL=analytics.js.map
// Core data types for claw-diary
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Model pricing per 1M tokens (input/output) in USD
export const MODEL_PRICING = {
    'claude-opus-4-6': { input: 15.0, output: 75.0 },
    'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
    'claude-sonnet-4-0-20250514': { input: 3.0, output: 15.0 },
    'claude-opus-4-0-20250514': { input: 15.0, output: 75.0 },
    'gpt-4o': { input: 2.50, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1': { input: 15.0, output: 60.0 },
    'o3-mini': { input: 1.10, output: 4.40 },
    // Default fallback
    'default': { input: 3.0, output: 15.0 },
};
export function getDataDir() {
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    return `${home}/.claw-diary`;
}
export function getEventsDir() {
    return `${getDataDir()}/events`;
}
export function getTodayFileName() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.jsonl`;
}
export function getDateFileName(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.jsonl`;
}
export function estimateCost(model, inputTokens, outputTokens) {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
// ── Common event loading ──
export function loadEventsForDate(date) {
    const filePath = join(getEventsDir(), getDateFileName(date));
    if (!existsSync(filePath))
        return [];
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const events = [];
    for (const line of lines) {
        try {
            events.push(JSON.parse(line));
        }
        catch { /* skip */ }
    }
    return events;
}
export function loadEventsForDays(days) {
    const events = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        events.push(...loadEventsForDate(date));
    }
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
// ── Common formatting ──
export function formatDuration(ms) {
    if (ms < 60_000)
        return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000)
        return `${Math.round(ms / 60_000)}min`;
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.round((ms % 3_600_000) / 60_000);
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}
export function formatCost(cost) {
    return `$${cost.toFixed(2)}`;
}
export function formatTokens(tokens) {
    if (tokens >= 1_000_000)
        return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000)
        return `${(tokens / 1_000).toFixed(1)}K`;
    return `${tokens}`;
}
// ── Config ──
export function loadConfig() {
    const configPath = join(getDataDir(), 'config.json');
    const defaults = { recordingLevel: 'full', dataDir: getDataDir() };
    if (!existsSync(configPath))
        return defaults;
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        return {
            recordingLevel: raw.recordingLevel || defaults.recordingLevel,
            dataDir: raw.dataDir || defaults.dataDir,
        };
    }
    catch {
        return defaults;
    }
}
//# sourceMappingURL=types.js.map
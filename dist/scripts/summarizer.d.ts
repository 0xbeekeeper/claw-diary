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
import { DiarySummary } from './types.js';
export declare function generateDailySummary(date: Date): DiarySummary;
export declare function generateWeeklySummary(): string;
//# sourceMappingURL=summarizer.d.ts.map
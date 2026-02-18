#!/usr/bin/env node
/**
 * claw-diary timeline generator
 *
 * Generates an interactive HTML timeline with a diary/journal aesthetic.
 * Usage:
 *   node timeline.js [YYYY-MM-DD]  — Generate timeline for a date (default: today)
 *   node timeline.js week          — Generate timeline for this week
 */
import { DiaryEvent } from './types.js';
export declare function generateTimelineHtml(events: DiaryEvent[], title: string): string;
//# sourceMappingURL=timeline.d.ts.map
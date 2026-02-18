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
import { DiaryAnalytics } from './types.js';
export declare function generateStats(): DiaryAnalytics;
//# sourceMappingURL=analytics.d.ts.map
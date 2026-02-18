import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { estimateCost, getDateFileName, formatDuration, formatCost, formatTokens, loadConfig } from '../scripts/types.js';
describe('estimateCost', () => {
    it('calculates cost for known model', () => {
        // claude-sonnet-4-5: input $3/M, output $15/M
        const cost = estimateCost('claude-sonnet-4-5-20250929', 1_000_000, 1_000_000);
        assert.equal(cost, 3.0 + 15.0);
    });
    it('uses default pricing for unknown model', () => {
        // default: input $3/M, output $15/M
        const cost = estimateCost('unknown-model', 1_000_000, 0);
        assert.equal(cost, 3.0);
    });
    it('returns 0 for zero tokens', () => {
        assert.equal(estimateCost('claude-opus-4-6', 0, 0), 0);
    });
    it('handles fractional tokens correctly', () => {
        // 1000 input tokens on opus: 1000 * 15 / 1_000_000 = 0.015
        const cost = estimateCost('claude-opus-4-6', 1000, 0);
        assert.ok(Math.abs(cost - 0.015) < 0.0001);
    });
});
describe('getDateFileName', () => {
    it('formats date as YYYY-MM-DD.jsonl', () => {
        const date = new Date('2025-03-15T12:00:00');
        assert.equal(getDateFileName(date), '2025-03-15.jsonl');
    });
    it('pads single-digit months and days', () => {
        const date = new Date('2025-01-05T00:00:00');
        assert.equal(getDateFileName(date), '2025-01-05.jsonl');
    });
});
describe('formatDuration', () => {
    it('formats seconds', () => {
        assert.equal(formatDuration(5000), '5s');
        assert.equal(formatDuration(30000), '30s');
    });
    it('formats minutes', () => {
        assert.equal(formatDuration(120000), '2min');
        assert.equal(formatDuration(600000), '10min');
    });
    it('formats hours and minutes', () => {
        assert.equal(formatDuration(3_600_000), '1h');
        assert.equal(formatDuration(5_400_000), '1h 30min');
    });
});
describe('formatCost', () => {
    it('formats with dollar sign and two decimals', () => {
        assert.equal(formatCost(0), '$0.00');
        assert.equal(formatCost(1.5), '$1.50');
        assert.equal(formatCost(10.123), '$10.12');
    });
});
describe('formatTokens', () => {
    it('formats small numbers as-is', () => {
        assert.equal(formatTokens(500), '500');
    });
    it('formats thousands as K', () => {
        assert.equal(formatTokens(1500), '1.5K');
        assert.equal(formatTokens(10000), '10.0K');
    });
    it('formats millions as M', () => {
        assert.equal(formatTokens(2_500_000), '2.5M');
    });
});
describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
        const config = loadConfig();
        assert.equal(config.recordingLevel, 'full');
        assert.ok(config.dataDir.endsWith('.claw-diary'));
    });
});
//# sourceMappingURL=test-types.js.map
/**
 * FlowGuard Tests — Number and Currency Formatter
 */
import { strict as assert } from 'assert';
import { test, describe, before } from 'node:test';

describe('Number & Currency Formatter', () => {
  before(() => {
    // Mock matchMedia for node environment
    if (typeof window === 'undefined') {
      globalThis.window = {
        matchMedia: () => ({ matches: false })
      };
    }
  });

  test('formats INR compact values accurately (Lakhs and Crores)', async () => {
    const { formatINR } = await import('../motion/number.js');
    
    assert.equal(formatINR(2480000), '₹24.8L');
    assert.equal(formatINR(4270000), '₹42.7L');
    assert.equal(formatINR(50000), '₹50.0K');
    assert.equal(formatINR(15000000), '₹1.5Cr');
    assert.equal(formatINR(-320000), '-₹3.2L');
  });

  test('formats INR standard non-compact mode', async () => {
    const { formatINR } = await import('../motion/number.js');
    const result = formatINR(50000, { compact: false });
    assert.ok(result.includes('50,000') || result.includes('50000'));
    assert.ok(result.startsWith('₹'));
  });
});

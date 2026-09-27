import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bankTransparency, overallHealthTrend } from '../tools/lib/transparency.mjs';

describe('شاخص شفافیت و سلامت', () => {
  it('bankTransparency امتیاز شفافیت بر پایه اطمینان و تازگی محاسبه می‌کند', () => {
    const products = [
      { bank: 'بانک ملی', bankId: 'bmi', confidence: 'high', stale: false, lastSeen: new Date().toISOString().slice(0, 10), digital: 80 },
      { bank: 'بانک ملی', bankId: 'bmi', confidence: 'high', stale: false, lastSeen: new Date().toISOString().slice(0, 10), digital: 70 },
      { bank: 'بانک ملت', bankId: 'mellat', confidence: 'medium', stale: true, lastSeen: '2026-01-01', digital: 40 },
    ];
    const res = bankTransparency(products);
    assert.equal(res.length, 2);
    assert.equal(res[0].bank, 'بانک ملی');
    assert.ok(res[0].transparencyScore > res[1].transparencyScore);
  });

  it('overallHealthTrend تاریخچه را مرتب می‌کند', () => {
    const history = [
      { generatedAt: '2026-09-20T00:00:00Z', stats: { healthScore: 80, freshnessPercent: 70, totalProducts: 200 }, anomalies: { total: 5 } },
      { generatedAt: '2026-09-13T00:00:00Z', stats: { healthScore: 75, freshnessPercent: 60, totalProducts: 190 }, anomalies: { total: 8 } },
    ];
    const trend = overallHealthTrend(history);
    assert.equal(trend.length, 2);
    assert.ok(trend[0].date <= trend[1].date);
  });
});

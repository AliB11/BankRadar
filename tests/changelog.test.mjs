import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffProducts, changelogToMarkdown, changelogToRSS } from '../tools/lib/changelog.mjs';

describe('ابزار changelog هوشمند', () => {
  it('diffProducts افزوده، نرخ تغییر و حذف را تشخیص می‌دهد', () => {
    const oldP = [
      { id: 'a', bank: 'بانک ملی', product: 'سپرده ۲۰٪', rate: 20, maxAmount: 100_000_000, lastSeen: '2026-09-20', stale: false, confidence: 'high' },
      { id: 'b', bank: 'بانک ملت', product: 'وام ۲۳٪', rate: 23, maxAmount: 200_000_000, lastSeen: '2026-09-01', stale: false, confidence: 'medium' },
    ];
    const newP = [
      { id: 'a', bank: 'بانک ملی', product: 'سپرده ۲۰٪', rate: 22, maxAmount: 100_000_000, lastSeen: '2026-09-27', stale: false, confidence: 'high' },
      { id: 'c', bank: 'بلوبانک', product: 'وام فوری', rate: 18, maxAmount: 50_000_000, lastSeen: '2026-09-27', stale: false, confidence: 'high' },
    ];
    const d = diffProducts(oldP, newP);
    assert.equal(d.summary.added, 1);
    assert.equal(d.summary.removed, 1);
    assert.equal(d.summary.rateChanged, 1);
    assert.equal(d.added[0].id, 'c');
    assert.equal(d.rateChanged[0].oldRate, 20);
    assert.equal(d.rateChanged[0].newRate, 22);
  });

  it('changelogToMarkdown متن خوانا تولید می‌کند', () => {
    const diff = {
      added: [{ id: 'x', bank: 'بانک تست', product: 'محصول جدید', rate: 20 }],
      removed: [],
      rateChanged: [{ id: 'a', bank: 'بانک ملی', product: 'سپرده', from: 20, to: 22, delta: 2, oldRate: 20, newRate: 22, diff: 2 }],
      amountChanged: [],
      termChanged: [],
      confidenceChanged: [],
      revived: [],
      staleNow: [],
      summary: { added: 1, removed: 0, rateChanged: 1, amountChanged: 0, termChanged: 0, confidenceChanged: 0, revived: 0, staleNow: 0, totalChanges: 2 },
    };
    const md = changelogToMarkdown(diff, { date: '2026-09-27' });
    assert.match(md, /تغییرات/);
    assert.match(md, /محصول جدید/);
    // نرخ جدید باید در خروجی باشد — چه فارسی چه لاتین
    assert.ok(md.includes('22') || md.includes('۲۲'), 'باید نرخ 22 در markdown باشد');
  });

  it('changelogToRSS فید XML معتبر تولید می‌کند', () => {
    const diff = {
      added: [],
      removed: [],
      rateChanged: [],
      amountChanged: [],
      termChanged: [],
      confidenceChanged: [],
      revived: [],
      staleNow: [],
      summary: { added: 0, removed: 0, rateChanged: 0, amountChanged: 0, termChanged: 0, confidenceChanged: 0, revived: 0, staleNow: 0, totalChanges: 0 },
    };
    const rss = changelogToRSS(diff, { date: '2026-09-27T00:00:00.000Z' });
    assert.match(rss, /<rss/);
    assert.match(rss, /<channel>/);
  });
});

/**
 * آزمون منابع رسمی و تطبیقی که در ممیزی ۱۲ آبان ۱۴۰۵ جایگزین شدند:
 *   ۱. جدول نرخ سیاستی بانک مرکزی (نشانی تازه به‌جای simplelist حذف‌شده)
 *   ۲. پارسر جدول سقف سپرده در منابع جایگزین (دیجی‌شهر ژئوبلاک است)
 *   ۳. سبدهای تازگی داده در meta.json
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPolicyRateTable, applyPolicyRates } from '../tools/sources/cbi.mjs';
import { parseCapTable, parseInterbank } from '../tools/sources/crosscheck.mjs';
import { freshnessBuckets } from '../tools/collect.mjs';
import { freshnessClass, buildHealthReport, sourceStatus } from '../tools/source-health.mjs';

/** نمونهٔ ساختار صفحهٔ PolicyRates بانک مرکزی (سلول‌های فارسی) */
const POLICY_HTML = `<html><body><table>
  <tr><th>تاریخ</th><th>نرخ بازار بین‌بانکی(%)</th><th>حداقل نرخ توافق بازخرید(%)</th><th>نرخ اعتبارگیری قاعده‌مند(%)</th><th>نرخ سپرده‌گذاری قاعده‌مند(%)</th></tr>
  <tr><td>۱۴۰۵/۰۸/۰۷</td><td>24.00</td><td>23</td><td>24</td><td>17</td></tr>
  <tr><td>۱۴۰۵/۰۷/۳۰</td><td>24.00</td><td>23</td><td>24</td><td>17</td></tr>
  <tr><td>۱۴۰۵/۰۱/۰۵</td><td>21.36</td><td>23</td><td>24</td><td>17</td></tr>
</table></body></html>`;

const CAP_HTML = `<table>
  <tr><td>کوتاه‌مدت عادی</td><td>۵ درصد</td></tr>
  <tr><td>کوتاه‌مدت ویژه سه‌ماهه</td><td>۱۲ درصد</td></tr>
  <tr><td>کوتاه‌مدت ویژه شش‌ماهه</td><td>۱۷ درصد</td></tr>
  <tr><td>بلندمدت یک‌ساله</td><td>۲۰٫۵ درصد</td></tr>
  <tr><td>بلندمدت دوساله</td><td>۲۱٫۵ درصد</td></tr>
  <tr><td>بلندمدت سه‌ساله</td><td>۲۲٫۵ درصد</td></tr>
</table>`;

test('extractPolicyRateTable ردیف‌های جدول رسمی را می‌خواند', () => {
  const rows = extractPolicyRateTable(POLICY_HTML);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    { date: rows[0].date, interbank: rows[0].interbank, repo: rows[0].repoFloor, corridor: rows[0].corridorCeiling, deposit: rows[0].depositFacility },
    { date: '1405/08/07', interbank: 24, repo: 23, corridor: 24, deposit: 17 },
  );
  assert.equal(rows[0].iso, '2026-10-29');
});

test('extractPolicyRateTable روی HTML بی‌ربط خالی برمی‌گرداند (نه استثنا)', () => {
  assert.deepEqual(extractPolicyRateTable('<html><body>Page Not Found</body></html>'), []);
});

test('applyPolicyRates نرخ رسمی را جای نرخ رسانه‌ای می‌گذارد و تاریخ رسمی ثبت می‌کند', () => {
  const base = {
    indicators: {
      interbankRate: {
        label: 'نرخ سود بازار بین‌بانکی',
        value: 24,
        period: 'شهریور ۱۴۰۵',
        source: { kind: 'press', title: 'نبض قیمت', url: 'https://nabzgheymat.ir/' },
      },
    },
  };
  const rows = extractPolicyRateTable(POLICY_HTML);
  const { indicators, touched } = applyPolicyRates(base, rows, { now: '2026-11-03T00:00:00.000Z' });

  assert.equal(indicators.indicators.interbankRate.value, 24);
  assert.equal(indicators.indicators.interbankRate.period, 'آبان ۱۴۰۵');
  assert.equal(indicators.indicators.interbankRate.source.kind, 'regulator');
  assert.equal(indicators.indicators.interbankRate.officialDate, '2026-10-29');
  // شاخص‌های تکمیلی کریدور هم اضافه می‌شوند
  assert.equal(indicators.indicators.repoFloorRate.value, 23);
  assert.equal(indicators.indicators.depositFacilityRate.value, 17);
  assert.ok(touched.some((t) => t.startsWith('interbankRate')));
});

test('applyPolicyRates عقب‌گرد نمی‌کند', () => {
  const base = {
    indicators: {
      interbankRate: {
        label: 'نرخ سود بازار بین‌بانکی',
        value: 25,
        source: { kind: 'regulator', url: 'https://www.cbi.ir/PolicyRates/policyrates_fa.aspx' },
        officialDate: '2026-11-01',
      },
    },
  };
  const rows = extractPolicyRateTable(POLICY_HTML); // تازه‌ترین: 2026-10-29
  const { indicators } = applyPolicyRates(base, rows);
  assert.equal(indicators.indicators.interbankRate.value, 25, 'داده تازه‌تر نباید با snapshot قدیمی‌تر بازنویسی شود');
});

test('parseCapTable سقف‌های سپرده را از جدول فارسی بیرون می‌کشد', () => {
  assert.deepEqual(parseCapTable(CAP_HTML), {
    depositShortNormal: 5,
    depositShort3m: 12,
    depositShort6m: 17,
    depositCap1y: 20.5,
    depositCap2y: 21.5,
    depositCap3y: 22.5,
  });
});

test('parseCapTable صفحهٔ بدون جدول را خالی برمی‌گرداند', () => {
  assert.deepEqual(parseCapTable('<html><body>Page Not Found</body></html>'), {});
});

test('parseInterbank نرخ بین‌بانکی را از متن می‌خواند', () => {
  assert.equal(parseInterbank('<p>نرخ سود بازار بین‌بانکی در هفته منتهی به ۹ مهر روی ۲۴ درصد باقی ماند</p>'), 24);
  assert.equal(parseInterbank('<p>چیزی نیست</p>'), null);
});

test('freshnessBuckets رکوردها را بر پایهٔ تاریخ ویرایش سبدبندی می‌کند', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const products = [
    { lastUpdated: '2026-11-01' },
    { lastUpdated: '2026-10-20' },
    { lastUpdated: '2026-09-01' },
    { lastUpdated: '2026-01-01' },
    { lastUpdated: null, lastSeen: '2026-11-02' },
    { lastUpdated: null, source: { checked: '2026-10-25' } },
    {},
  ];
  const buckets = freshnessBuckets(products, now);
  assert.equal(buckets.total, 7);
  assert.equal(buckets.d7, 1); // 2026-11-01
  assert.equal(buckets.d30, 2); // 2026-10-20 و 2026-10-25 (source.checked)
  assert.equal(buckets.d90, 1); // 2026-09-01
  assert.equal(buckets.older, 1);
  assert.equal(buckets.unknown, 2, 'رکورد بدون تاریخ محتوا نامعلوم است، حتی اگر دیده شده باشد');
  assert.equal(buckets.seenButUndated, 1, 'دیده‌شدن بدون تاریخ محتوا جدا شمرده می‌شود');
  assert.equal(buckets.d7 + buckets.d30 + buckets.d90 + buckets.older + buckets.unknown, buckets.total);
});

test('freshnessClass و sourceStatus رده‌بندی درست می‌دهند', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  assert.equal(freshnessClass('2026-11-01', now), 'fresh');
  assert.equal(freshnessClass('2026-10-10', now), 'recent');
  assert.equal(freshnessClass('2026-09-01', now), 'aging');
  assert.equal(freshnessClass('2026-01-01', now), 'stale');
  assert.equal(freshnessClass(null, now), 'unknown');

  assert.equal(sourceStatus({ ok: true }), 'ok');
  assert.equal(sourceStatus({ ok: true, degraded: true }), 'degraded');
  assert.equal(sourceStatus({ ok: false, error: 'x' }), 'down');
});

test('buildHealthReport منبع آرشیوی را degraded و منبع مرده را down نشان می‌دهد', () => {
  const report = buildHealthReport({
    now: new Date('2026-11-03T00:00:00Z'),
    meta: {
      lastRun: '2026-11-03T11:07:49.288Z',
      sources: [
        { name: 'rade.ir', ok: true, parsed: 150 },
        { name: 'dgshahr.com', ok: true, via: 'wayback', observedAt: '2026-10-12T07:52:33Z' },
        { name: 'isignal.ir', ok: false, error: 'شبکه در دسترس نبود' },
      ],
    },
    products: { products: [{ category: 'deposits', lastUpdated: '2026-11-01' }] },
    indicators: { indicators: {} },
    crosscheck: { generatedAt: '2026-11-03T00:00:00Z', summary: { matched: 4, mismatched: 1, unverified: 0 }, checks: [{ key: 'depositCap1y', label: 'سقف یک‌ساله', ours: 20.5, status: 'mismatch', observations: [{ source: 'finai', value: 21 }] }] },
  });

  const byName = Object.fromEntries(report.sources.map((s) => [s.name, s]));
  assert.equal(byName['rade.ir'].status, 'ok');
  assert.equal(byName['dgshahr.com'].status, 'degraded');
  assert.equal(byName['isignal.ir'].status, 'down');
  assert.deepEqual(report.degradedSources.sort(), ['dgshahr.com', 'isignal.ir']);
  assert.equal(report.crosscheck.mismatches.length, 1);
  assert.equal(report.freshness.d7, 1);
});

test('extractPolicyRateTable اگر جدول HTML نبود، از متن پشتیبان می‌خواند', () => {
  const html = '<html><body><div>۱۴۰۵/۰۸/۰۷ 24.00 23 24 17</div></body></html>';
  const rows = extractPolicyRateTable(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].interbank, 24);
  assert.equal(rows[0].depositFacility, 17);
});

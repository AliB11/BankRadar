/**
 * آزمون گزارش اکسل هفتگی (tools/export-report.mjs).
 *
 * نکتهٔ حیاتی: امتیازهای این گزارش باید با موتور مرورگر یکی باشند؛ اگر
 * score.js از مسیر Node به هر دلیلی متفاوت عمل کند، عدد اکسل با عدد سایت
 * نمی‌خواند و اعتماد به گزارش می‌شکند. این آزمون همان‌جا قفلش می‌کند.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildReport, buildReportSheets } from '../tools/export-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

const sampleProducts = [
  {
    id: 'dep-1', bank: 'بانک نمونه', product: 'سپرده یک‌ساله', category: 'deposits',
    rate: 20.5, rateKind: 'profit', maxAmount: null, minAmount: 1_000_000, termMonths: 12,
    collateral: '—', collateralKind: 'none', confidence: 'high', stale: false,
    lastUpdated: '2026-10-01', lastSeen: '2026-11-03',
    source: { url: 'https://example.com/dep' }, desc: 'سپردهٔ آزمون',
  },
  {
    id: 'loan-1', bank: 'بانک نمونه', product: 'وام آزمون', category: 'loans',
    rate: 4, rateKind: 'profit', maxAmount: 300_000_000, minAmount: null, termMonths: 36,
    collateral: 'ضامن', collateralKind: 'guarantor', confidence: 'medium', stale: false,
    lastUpdated: '2026-09-15', source: { url: '' }, desc: 'وام آزمون',
  },
];

const sampleIndicators = {
  inflationAnnual: { label: 'تورم سالانه', value: 76.8, period: 'مهر ۱۴۰۵', sourceKind: 'press' },
};

test('سه برگه با ستون‌ها و سربرگ‌های درست می‌سازد', () => {
  const sheets = buildReportSheets({ products: sampleProducts, indicators: sampleIndicators });
  assert.deepEqual(sheets.map((s) => s.name), ['محصولات', 'شاخص‌های کلان', 'خلاصه']);
  assert.equal(sheets[0].columns.length, 20);
  assert.equal(sheets[0].rows.length, 2);
  assert.equal(sheets[1].rows.length, 1);
  // سربرگ دقیق برای ستون امتیاز
  assert.equal(sheets[0].columns[9], 'امتیاز جذابیت');
});

test('امتیاز اکسل با همان موتور مرورگر حساب می‌شود', async () => {
  const { scoreProduct, DEFAULT_WEIGHTS } = await import('../assets/js/score.js');
  const sheets = buildReportSheets({ products: sampleProducts, indicators: sampleIndicators });
  const expected = scoreProduct(sampleProducts[0], DEFAULT_WEIGHTS, { inflation: 76.8 });
  assert.equal(sheets[0].rows[0][9], expected.score, 'امتیاز سپرده در اکسل باید با سایت یکی باشد');
  assert.equal(sheets[0].rows[0][10], expected.realRate, 'بازده حقیقی اکسل باید با سایت یکی باشد');
  // موتور امتیاز برای رکورد ناقص هم تلخ‌پذیر است و عدد ۰–۱۰۰ می‌دهد —
  // مهم این است که مقدار از خود موتور می‌آید، نه عدد جعلی بیرون موتور.
  const broken = buildReportSheets({ products: [{ id: 'x', category: 'loans' }], indicators: sampleIndicators });
  assert.ok(Number.isFinite(broken[0].rows[0][9]) && broken[0].rows[0][9] >= 0 && broken[0].rows[0][9] <= 100);
});

test('برگه خلاصه، شمارش دسته‌ها و تورم مرجع را دارد', () => {
  const sheets = buildReportSheets({ products: sampleProducts, indicators: sampleIndicators });
  const summary = sheets[2];
  const labels = summary.rows.map((r) => r[0]);
  assert.ok(labels.includes('تعداد کل محصولات'));
  assert.ok(labels.some((l) => String(l).startsWith('دسته: deposits')));
  const totalRow = summary.rows.find((r) => r[0] === 'تعداد کل محصولات');
  assert.equal(totalRow[1], 2);
  const inflRow = summary.rows.find((r) => r[0] === 'تورم سالانه مرجع (%)');
  assert.equal(inflRow[1], 76.8);
});

test('buildReport از پوشهٔ داده واقعی می‌خواند و CLI فایل PK دار می‌سازد', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bankradar-report-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'products.json'),
      JSON.stringify({ products: sampleProducts }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tmp, 'indicators.json'),
      JSON.stringify({ indicators: sampleIndicators }),
      'utf8',
    );
    await fs.writeFile(path.join(tmp, 'meta.json'), JSON.stringify({ lastRunMode: 'full' }), 'utf8');

    const { bytes, count } = await buildReport({ dataDir: tmp });
    assert.equal(count, 2);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);

    const out = path.join(tmp, 'out.xlsx');
    await run(process.execPath, [path.join(ROOT, 'tools', 'export-report.mjs'), `--dir=${tmp}`, `--out=${out}`]);
    const written = await fs.readFile(out);
    assert.ok(written.length > 500, 'فایل CLI بیش‌ازحد کوچک است');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('پوشهٔ دادهٔ خالی، شکست صریح می‌دهد نه گزارش تهی', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bankradar-report-empty-'));
  try {
    await fs.writeFile(path.join(tmp, 'products.json'), JSON.stringify({ products: [] }), 'utf8');
    await assert.rejects(() => buildReport({ dataDir: tmp }), /هیچ محصولی/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

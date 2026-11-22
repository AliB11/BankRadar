/**
 * آزمون گیت تازگی بارگذاری داده.
 *
 * گلوگاه پیشین عملکرد: data/products.json (بیش از ۱٫۶MB) در هر بارگذاری صفحه
 * دانلود می‌شد و در حالت عادی — که بسته درون‌خطی هم‌نسخهٔ آن است — کامل دور
 * انداخته می‌شد. این آزمون قفل می‌کند که:
 *   ۱. وقتی meta.json همان نسخهٔ بسته را نشان می‌دهد، products.json اصلاً
 *      گرفته نشود؛
 *   ۲. وقتی meta نسخهٔ تازه‌تری نشان دهد، products.json گرفته و جایگزین شود؛
 *   ۳. فیدهای هفتگی موازی گرفته شوند نه پشت‌سرهم.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** بستهٔ واقعی همان چیزی است که مرورگر می‌بیند */
const bundleSource = read('data/bundle.js');
const sandbox = {};
new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;
const bundle = sandbox.__BANK_RADAR__;

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

function jsonResponse(obj) {
  return {
    ok: true,
    json: async () => obj,
  };
}

/** شمارش درخواست هر نشانی و پاسخ ساختگی با فایل واقعی داده */
function stubFetch({ meta, productsPayload }) {
  const counts = new Map();
  const count = (url) => {
    const base = String(url).split('?')[0];
    counts.set(base, (counts.get(base) ?? 0) + 1);
    return base;
  };
  globalThis.fetch = async (url) => {
    const base = count(url);
    switch (base) {
      case 'data/meta.json':
        return jsonResponse(meta);
      case 'data/products.json':
        return jsonResponse(productsPayload ?? JSON.parse(read('data/products.json')));
      case 'data/indicators.json':
        return jsonResponse(JSON.parse(read('data/indicators.json')));
      case 'data/banks.json':
        return jsonResponse(JSON.parse(read('data/banks.json')));
      case 'data/weekly-report.json':
        return jsonResponse(JSON.parse(read('data/weekly-report.json')));
      case 'data/changelog.json':
        return jsonResponse(JSON.parse(read('data/changelog.json')));
      case 'data/history/weekly-history.json':
        return jsonResponse(JSON.parse(read('data/history/weekly-history.json')));
      default:
        return { ok: false, json: async () => null };
    }
  };
  return counts;
}

function nextDay(iso) {
  const d = new Date(Date.parse(iso) + 86_400_000);
  return d.toISOString();
}

test('گیت تازگی: بسته هم‌نسخه → products.json گرفته نمی‌شود و داده از بسته می‌آید', async () => {
  const { loadData, store } = await import('../assets/js/store.js');

  const meta = {
    version: 2,
    lastRun: nextDay(bundle.meta.generatedAt),
    productsGeneratedAt: bundle.meta.generatedAt, // هم‌نسخهٔ بسته
    counts: { total: bundle.products.length },
    sources: [],
  };
  const counts = stubFetch({ meta });

  const ok = await loadData();
  assert.ok(ok, 'بارگذاری ناموفق');
  assert.equal(counts.get('data/products.json') ?? 0, 0, 'products.json نباید در بارگذاری معمولی گرفته شود');
  assert.equal((counts.get('data/meta.json') ?? 0), 1, 'meta.json فقط یک‌بار گرفته شود');
  assert.equal(store.meta.loadSource, 'bundle', 'داده باید از بسته درون‌خطی بیاید');
  assert.equal(store.products.length, bundle.products.length);
});

test('گیت تازگی: meta تازه‌تر → products.json گرفته و جایگزین می‌شود', async () => {
  const { loadData, store } = await import('../assets/js/store.js');

  const real = JSON.parse(read('data/products.json'));
  const newer = {
    ...real,
    generatedAt: nextDay(bundle.meta.generatedAt),
    counts: { ...real.counts, total: real.counts.total + 1, deposits: real.counts.deposits + 1 },
    products: [
      ...real.products,
      {
        id: 'load-gate-test-product',
        bank: 'بانک آزمون',
        product: 'محصول آزمون گیت بارگذاری',
        category: 'deposits',
        subcategory: 'term',
        rate: 21,
        rateKind: 'profit',
        source: { title: 'آزمون', url: 'https://example.com/', kind: 'press' },
        lastUpdated: nextDay(bundle.meta.generatedAt).slice(0, 10),
      },
    ],
  };

  const meta = {
    version: 2,
    lastRun: nextDay(bundle.meta.generatedAt),
    productsGeneratedAt: newer.generatedAt, // از بسته تازه‌تر
    counts: newer.counts,
    sources: [],
  };
  const counts = stubFetch({ meta, productsPayload: newer });

  const ok = await loadData();
  assert.ok(ok, 'بارگذاری ناموفق');
  assert.equal(counts.get('data/products.json') ?? 0, 1, 'products.json باید وقتی نسخه تازه‌تر است گرفته شود');
  assert.equal(store.meta.loadSource, 'json', 'داده JSON تازه باید جایگزین بسته شود');
  assert.ok(store.products.some((p) => p.id === 'load-gate-test-product'), 'محصول تازه باید وارد شود');
});

test('فیدهای هفتگی موازی گرفته می‌شوند، نه پشت‌سرهم', async () => {
  const { loadData } = await import('../assets/js/store.js');

  let inFlight = 0;
  let maxConcurrent = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const base = String(url).split('?')[0];
    if (['data/weekly-report.json', 'data/changelog.json', 'data/history/weekly-history.json'].includes(base)) {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return realFetch(url);
    }
    return realFetch(url);
  };
  try {
    await loadData();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(maxConcurrent, 3, 'سه فید باید هم‌زمان در پرواز باشند');
});

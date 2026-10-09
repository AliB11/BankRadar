/** آزمون‌های جست‌وجوی مستقیم محصولات در همه دسته‌ها. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleSource = fs.readFileSync(path.join(ROOT, 'data/bundle.js'), 'utf8');
const sandbox = {};
new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;

const { store, loadData, searchProducts, filtered } = await import('../assets/js/store.js');
await loadData();

test('جست‌وجوی مستقیم مستقل از دسته و فیلترهای فهرست است', () => {
  const oldCategory = store.filters.category;
  const oldQuery = store.filters.query;
  store.filters.category = 'deposits';
  store.filters.query = 'وام ازدواج';

  const matches = searchProducts('وام ازدواج', { limit: 6 });
  assert.ok(matches.length > 0, 'باید برای عبارت متداول نتیجه وجود داشته باشد');
  assert.ok(matches.some((p) => p.category === 'loans'), 'محصول وام باید در دسته غیرفعال هم قابل جست‌وجو باشد');
  assert.ok(matches.length <= 6, 'پیشنهادها باید محدود باشند');
  assert.ok(filtered().every((p) => p.category === 'deposits'), 'فهرست عادی باید فیلتر دسته خود را حفظ کند');

  store.filters.category = oldCategory;
  store.filters.query = oldQuery;
});

test('جست‌وجو ی و ک عربی، ارقام فارسی و برچسب نرخ را نرمال می‌کند', () => {
  const arabicKeyboard = searchProducts('بانك قرض', { limit: 6 });
  assert.ok(arabicKeyboard.length > 0, 'کاف عربی باید با کاف فارسی یکی باشد');

  const persianDigits = searchProducts('سپرده ۲۳٪', { limit: 6 });
  assert.ok(persianDigits.length > 0, 'نرخ با ارقام فارسی باید پیدا شود');
  assert.ok(persianDigits.some((p) => p.rate === 23), 'جست‌وجوی نرخ باید به داده عددی محصول برسد');
});

test('جست‌وجوی خالی نتیجه نمی‌دهد و سقف صفر پیشنهاد نمی‌سازد', () => {
  assert.deepEqual(searchProducts('   '), []);
  assert.deepEqual(searchProducts('وام ازدواج', { limit: 0 }), []);
});

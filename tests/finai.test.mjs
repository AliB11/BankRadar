/**
 * آزمون منبع FinAI — جدول بانک‌محور «سقف طرح ویژه» سپرده‌ها.
 *
 * FinAI منبع دوم نرخ‌های ترجیحی است (دیجی‌شهر منبع اصلی است ولی ژئوبلاک).
 * آزمون‌ها سه قرارداد کلیدی را قفل می‌کنند:
 *   ۱. سطرهای نمونهٔ محاسبه سود و بانک‌های قرض‌الحسنه وارد محصولات نمی‌شوند؛
 *   ۲. بانک دارای رکورد ترجیحی موجود، محصول تکراری نمی‌گیرد — فقط تطبیق ثبت
 *      می‌شود (بازنویسی خودکار نرخ یک منبع با منبع دیگر ممنوع است)؛
 *   ۳. بانک بدون پوشش قبلی، محصول با شناسهٔ پایدارِ بدون‌نرخ می‌گیرد تا تغییر
 *      نرخ، شناسه را نشکند.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFinaiTable, mapToProducts, collect, FINAI_URL } from '../tools/sources/finai.mjs';
import { mergeProducts } from '../tools/collect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const banks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/banks.json'), 'utf8')).banks;
const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8')).products;

const TODAY = '2026-11-22';

/** برش کوچک HTML در الگوی واقعی صفحه FinAI — سطرهای واقعی و استثناها */
const FINAI_FIXTURE = `
<table>
  <tr><td><a href="#saman">سامان</a></td><td>۲۰٫۵٪</td><td>تا ۳۰٪</td><td>۱ میلیارد تومان</td><td>طرح کلان؛ برای پس‌انداز معمولی نیست</td></tr>
  <tr><td><a href="#maskan">مسکن</a></td><td>۲۰٫۵٪</td><td>تا ۲۸٪</td><td>۵۰۰ میلیون</td><td>بخشی ممکن است اوراق حق‌تقدم باشد</td></tr>
  <tr><td><a href="#refah">رفاه کارگران</a></td><td>۲۰٫۵٪</td><td>تا ۲۵٫۵٪</td><td>۳۰ میلیون</td><td>کمترین آستانه بین سقف‌های بالا</td></tr>
  <tr><td><a href="#sarmayeh">سرمایه</a></td><td>۲۰٫۵٪</td><td>تا ۲۲٫۵٪</td><td>۲۰ میلیون</td><td>وضعیت بانک را جدا چک کنید</td></tr>
  <tr><td>اقتصاد نوین</td><td>۲۰٫۵٪</td><td>۲۰٫۵٪</td><td>۱ میلیون</td><td>طرح سقف بالاتر گزارش نشده</td></tr>
  <tr><td>مهر ایران</td><td>—</td><td>—</td><td>—</td><td>قرض‌الحسنه؛ سود سرمایه‌گذاری ندارد</td></tr>
  <tr><td>۱۰۰ میلیون</td><td>~۴۱۷ هزار</td><td>~۱٫۷۱ میلیون</td><td>~۱٫۸۸ میلیون</td><td>~۲٫۱۳ میلیون</td></tr>
  <tr><td>۵۰۰ میلیون</td><td>~۲٫۰۸ میلیون</td><td>~۸٫۵۴ میلیون</td><td>~۹٫۳۸ میلیون</td><td>~۱۰٫۶۳ میلیون</td></tr>
</table>`;

test('parseFinaiTable: سطر بانک‌ها استخراج و سطرهای استثنا کنار گذاشته می‌شوند', () => {
  const rows = parseFinaiTable(FINAI_FIXTURE);
  const names = rows.map((r) => r.bank);
  assert.ok(names.includes('سامان'), 'سامان باید باشد');
  assert.ok(names.includes('مسکن'), 'مسکن باید باشد');
  assert.ok(names.includes('سرمایه'), 'سرمایه باید باشد');
  assert.equal(names.length, 5, 'بانک قرض‌الحسنه (بدون نرخ) و سطرهای نمونهٔ عددی وارد نمی‌شوند');
  const saman = rows.find((r) => r.bank === 'سامان');
  assert.equal(saman.approved, 20.5);
  assert.equal(saman.ceiling, 30);
  assert.equal(saman.minAmount, 1_000_000_000);
  assert.ok(saman.note.length > 0);
});

test('parseFinaiTable: سقف بدون علامت درصد (سلول «۲۰٫۵٪» ساده) هم خوانده می‌شود', () => {
  const rows = parseFinaiTable(FINAI_FIXTURE);
  const en = rows.find((r) => r.bank === 'اقتصاد نوین');
  assert.equal(en.ceiling, 20.5);
});

test('mapToProducts: بانک بدون پوشش قبلی محصول جدید با شناسهٔ پایدار می‌گیرد', () => {
  const rows = parseFinaiTable(FINAI_FIXTURE);
  // موجود فرضی: فقط بانک‌های سامان/مسکن/رفاه رکورد ترجیحی دارند
  const existing = [
    { id: 'saman-deposit-pref-30', bank: 'بانک سامان', bankId: 'saman', category: 'deposits', subcategory: 'preferential', rate: 27 },
    { id: 'maskan-deposit-pref-28', bank: 'بانک مسکن', bankId: 'maskan', category: 'deposits', subcategory: 'preferential', rate: 28 },
    { id: 'refah-deposit-pref-28', bank: 'بانک رفاه کارگران', bankId: 'refah', category: 'deposits', subcategory: 'preferential', rate: 28 },
  ];
  const { products: mapped, corroboration } = mapToProducts(rows, { existing, banks, observedAt: TODAY });

  const ids = mapped.map((p) => p.id).sort();
  assert.deepEqual(ids, ['eghtesad-novin-deposit-pref', 'sarmayeh-deposit-pref'].sort(), 'فقط بانک‌های بی‌پوشش محصول می‌گیرند');
  for (const p of mapped) {
    assert.match(p.id, /^[a-z0-9][a-z0-9-]*$/, 'شناسه لاتین معتبر');
    assert.equal(p.category, 'deposits');
    assert.equal(p.subcategory, 'preferential');
    assert.equal(p.autoDiscovered, true);
    assert.equal(p.confidence, 'medium');
    assert.ok(p.source.url.includes('finai.ir'));
    assert.equal(p.lastSeen, TODAY);
    assert.ok(p.rate > 0 && p.rate <= 40);
  }
  const sarmayeh = mapped.find((p) => p.id === 'sarmayeh-deposit-pref');
  assert.equal(sarmayeh.rate, 22.5);
  assert.equal(sarmayeh.minAmount, 20_000_000);
  assert.match(sarmayeh.product, /۲۲\.۵٪/);

  // بانک‌های دارای رکورد موجود → فقط تطبیق، بدون محصول
  assert.equal(corroboration.length, 3);
  const samanC = corroboration.find((c) => c.bankId === 'saman');
  assert.equal(samanC.existingRate, 27);
  assert.equal(samanC.finaiRate, 30);
  assert.equal(samanC.agree, false, 'اختلاف ۲۷ در برابر ۳۰ باید دیده شود');
  const maskanC = corroboration.find((c) => c.bankId === 'maskan');
  assert.equal(maskanC.agree, true, 'توافق ۲۸ با ۲۸');
});

test('mapToProducts: بانک قرض‌الحسنه محصول نمی‌گیرد', () => {
  const rows = parseFinaiTable('<table><tr><td>مهر ایران</td><td>—</td><td>—</td><td>—</td><td>قرض‌الحسنه</td></tr></table>');
  const { products: mapped } = mapToProducts(rows, { existing: [], banks, observedAt: TODAY });
  assert.equal(mapped.length, 0);
});

test('collect با HTML تزریقی: قرارداد پاکت خروجی', async () => {
  const result = await collect({ html: FINAI_FIXTURE, existing: products, banks, log: () => {} });
  assert.equal(result.source, 'finai');
  assert.equal(result.via, 'injected');
  assert.equal(result.url, FINAI_URL);
  assert.ok(Array.isArray(result.products));
  assert.ok(Array.isArray(result.corroboration));
  assert.ok(result.rows >= 5);
  // با دادهٔ واقعی فعلی، بانک‌های سرمایه/صادرات/… باید محصول تازه بگیرند
  const covered = products.filter((p) => p.category === 'deposits' && p.subcategory === 'preferential');
  const coveredBanks = new Set(covered.map((p) => p.bankId));
  for (const p of result.products) {
    assert.ok(!coveredBanks.has(p.bankId), `بانک ${p.bankId} از قبل رکورد ترجیحی دارد — محصول تکراری ممنوع`);
  }
});

test('ادغام کامل: محصولات FinAI وارد مجموعه می‌شوند و رکورد موجود دست‌نخورده می‌ماند', () => {
  const existing = [
    { id: 'maskan-deposit-pref-28', bank: 'بانک مسکن', bankId: 'maskan', category: 'deposits', subcategory: 'preferential', rate: 28, autoDiscovered: true, source: { url: 'https://dgshahr.com/x', kind: 'press' } },
  ];
  const rows = parseFinaiTable(FINAI_FIXTURE);
  const { products: incoming, corroboration } = mapToProducts(rows, { existing, banks, observedAt: TODAY });
  assert.equal(incoming.some((p) => p.bankId === 'maskan'), false, 'مسکن محصول تکراری نمی‌گیرد');
  assert.equal(corroboration.find((c) => c.bankId === 'maskan').agree, true);

  const { merged, stats } = mergeProducts(existing, incoming);
  const afterBanks = new Set(merged.filter((p) => p.category === 'deposits' && p.subcategory === 'preferential').map((p) => p.bankId));
  assert.ok(afterBanks.has('sarmayeh'), 'بانک سرمایه افزوده شد');
  assert.equal(merged.find((p) => p.id === 'maskan-deposit-pref-28').rate, 28, 'نرخ مسکن بازنویسی نشد');
  assert.ok(stats.added >= 1);
});

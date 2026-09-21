/**
 * آزمون منبع دیجی‌شهر (جدول نرخ‌های سود سپرده و نرخ‌های ترجیحی).
 *
 * چرا این آزمون‌ها حیاتی‌اند: جدول نرخ‌های ترجیحی در خودِ مقاله ترتیب ستون‌های
 * ناهمگون دارد و سطرهای ادامه‌دار (rowspan) دارد؛ اگر پارسر ستون‌ها را جابه‌جا
 * بخواند، مبلغ و مدت با هم عوض می‌شوند و رکوردهای گمراه‌کننده ساخته می‌شود
 * بدون آنکه خطایی دیده شود. مبنای آزمون، اسنپ‌شات وفادار صفحه است.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseDgshahrHtml,
  parseBandAmount,
  parseRateCell,
  parseTermMonths,
  mapToProducts,
  collect,
  faDigits,
  DGSHAHR_URL,
} from '../tools/sources/dgshahr.mjs';
import { mergeProducts } from '../tools/collect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/dgshahr-deposit-rates.html');
const html = await fs.readFile(FIXTURE, 'utf8');

// از فهرست واقعی بانک‌ها (همان چیزی که خط لوله تغذیه می‌کند)
const banksData = JSON.parse(await fs.readFile(path.join(ROOT, 'data/banks.json'), 'utf8'));
const banks = banksData.banks;

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/* ---------- ۱) تجزیه جدول‌ها ---------- */

test('هر دو جدول نرخ و فهرست نرخ‌های مصوب استخراج می‌شوند', () => {
  const parsed = parseDgshahrHtml(html);

  assert.equal(parsed.tierRows.length, 51, '۵۱ پله نرخ ترجیحی (۱۸ بانک)');
  assert.equal(new Set(parsed.tierRows.map((r) => r.bank)).size, 18, 'پوشش ۱۸ بانک');
  assert.equal(parsed.schemeRows.length, 13, '۱۳ طرح ویژه سپرده‌گذاری');
  assert.equal(parsed.standard.length, 6, '۶ نرخ مصوب عددی (قرض‌الحسنه «صفر» است و عدد نیست)');

  const std = Object.fromEntries(parsed.standard.map((s) => [s.rate, s.label]));
  assert.ok(std[22.5] && std[20.5] && std[5], 'نرخ‌های مصوب کلیدی باید دیده شوند');
});

test('سلول‌های جابه‌جا (مبلغ/مدت) با محتوا طبقه‌بندی می‌شوند، نه با جای ستون', () => {
  const { tierRows } = parseDgshahrHtml(html);
  // در گروه بانک ملی، مقاله جای «حداقل مدت» و «حداقل موجودی» را عوض کرده است
  const melli22 = tierRows.find((r) => r.bank.includes('ملی') && r.rate === 22);
  assert.ok(melli22, 'پله ۲۲٪ بانک ملی باید باشد');
  assert.equal(melli22.termText, '۳ ماه', 'ماه باید مدت شمرده شود نه مبلغ');
  assert.equal(melli22.minAmount, 50_000_000, 'کف پله ۵۰ میلیون تومان');
  assert.equal(melli22.maxAmount, 100_000_000, 'سقف پله ۱۰۰ میلیون تومان');
});

test('متن نرخ شکست حاوی «ماه»، مدت شمرده نمی‌شود', () => {
  const { tierRows } = parseDgshahrHtml(html);
  const mellal = tierRows.find((r) => r.bank.includes('ملل') && r.rate === 30.5);
  assert.ok(mellal);
  assert.equal(mellal.termText, '۳ ماه', 'مدت واقعی سلول مدت است');
  assert.match(mellal.breakText, /۰\.۵/, 'نرخ شکست باید در جای خود بماند');
});

test('سطرهای ادامه‌دار (rowspan بانک) بانک را به ارث می‌برند', () => {
  const { tierRows } = parseDgshahrHtml(html);
  const melli = tierRows.filter((r) => r.bank.includes('ملی'));
  assert.equal(melli.length, 7, 'بانک ملی ۷ پله دارد؛ سطرهای ادامه‌دار نباید بی‌بانک بمانند');
  assert.ok(melli.every((r) => r.bank.includes('ملی')));
});

/* ---------- ۲) تجزیه عدد و نرخ ---------- */

test('بند مبلغی فارسی با واحدهای مختلط خوانده می‌شود', () => {
  assert.deepEqual(parseBandAmount('۵۰ تا ۱۰۰ میلیون تومان'), { min: 50_000_000, max: 100_000_000 });
  assert.deepEqual(parseBandAmount('۵۰۰ میلیون تا ۵ میلیارد تومان'), { min: 500_000_000, max: 5_000_000_000 });
  assert.deepEqual(parseBandAmount('یک میلیارد تومان و بیش‌تر'), { min: 1_000_000_000, max: null });
  assert.deepEqual(parseBandAmount('کم‌تر از ۵ میلیارد تومان'), { min: null, max: 5_000_000_000 });
  assert.deepEqual(parseBandAmount('۲-۵ میلیارد تومان'), { min: 2_000_000_000, max: 5_000_000_000 });
  assert.deepEqual(parseBandAmount('۲۰۰ هزار تومان'), { min: 200_000, max: null });
});

test('سلول نرخ با «٪» پیشوندی و بازه‌ها خوانده می‌شود؛ سقف مبنا است', () => {
  assert.deepEqual(parseRateCell('٪۳۰.۵'), { rate: 30.5, floor: 30.5 });
  assert.deepEqual(parseRateCell('۳۰.۵ تا ۳۱٪'), { rate: 31, floor: 30.5 });
  assert.deepEqual(parseRateCell('۲۵ الی ۳۰٪'), { rate: 30, floor: 25 });
  assert.deepEqual(parseRateCell('توافقی تا ۲۵٪'), { rate: 25, floor: 25 });
  assert.deepEqual(parseRateCell('٪۵ و با سقف سود ۲۲.۵٪'), { rate: 22.5, floor: 5 });
});

test('مدت فارسی به ماه تبدیل می‌شود', () => {
  assert.equal(parseTermMonths('یک ساله'), 12);
  assert.equal(parseTermMonths('۲ ساله'), 24);
  assert.equal(parseTermMonths('۳ ماه'), 3);
  assert.equal(parseTermMonths('۴ الی ۱۰ سال'), 48, 'کف بازه مبنا است');
  assert.equal(parseTermMonths('–'), null);
});

test('faDigits فقط ارقام را فارسی می‌کند', () => {
  assert.equal(faDigits('22.5٪'), '۲۲.۵٪');
  assert.equal(faDigits('سقف 30%'), 'سقف ۳۰%');
});

/* ---------- ۳) نگاشت به محصولات ---------- */

test('هر بانک یک نردبان ترجیحی و هر طرح یک محصول می‌گیرد', () => {
  const parsed = parseDgshahrHtml(html);
  const products = mapToProducts(parsed, { existing: [], banks });

  assert.equal(products.length, 31, '۱۸ ترجیحی + ۱۳ طرح');
  assert.ok(products.every((p) => ID_RE.test(p.id)), 'همه شناسه‌ها باید لاتین معتبر باشند');
  assert.ok(products.every((p) => p.category === 'deposits'));
  assert.ok(products.every((p) => p.source.url === DGSHAHR_URL));
  assert.ok(products.every((p) => p.autoDiscovered === true));

  const melli = products.find((p) => p.bankId === 'melli');
  assert.ok(melli, 'بانک ملی باید محصول ترجیحی داشته باشد');
  assert.equal(melli.subcategory, 'preferential');
  assert.equal(melli.rate, 29, 'بالاترین سقف پلکان مبنا است');
  assert.equal(melli.termMonths, 12, 'حساب‌های جدول یک‌ساله‌اند');
  assert.equal(melli.minAmount, 50_000_000, 'کف نردبان از خردترین پله');
  assert.equal(
    melli.requirements.filter((r) => r.includes('تومان')).length,
    7,
    'نردبان کامل هفت پله‌ای در requirements',
  );

  const saman = products.find((p) => p.bankId === 'saman' && p.subcategory === 'preferential');
  assert.equal(saman.rate, 27);
  assert.match(saman.rateLabel, /۲۴\.۵ تا ۲۷/);
});

test('رکورد ترجیحی موجود با همان شناسه به‌روز می‌شود، نه تکراری', () => {
  const parsed = parseDgshahrHtml(html);
  const prev = {
    id: 'saman-sp-deposit-30',
    bank: 'بانک سامان',
    bankId: 'saman',
    product: 'سپرده ویژه با سود ترجیحی ۳۰٪ (سپرده‌های کلان بالای ۱ میلیارد تومان)',
    category: 'deposits',
    subcategory: 'preferential',
    rate: 30,
    tags: ['سود ترجیحی', 'طرح نمونه'],
  };
  const products = mapToProducts(parsed, { existing: [prev], banks });
  const saman = products.find((p) => p.bankId === 'saman' && p.subcategory === 'preferential');

  assert.equal(saman.id, 'saman-sp-deposit-30', 'شناسه موجود باید بماند');
  assert.equal(saman.rate, 27, 'نرخ از جدول تازه می‌آید');
  assert.ok(!saman.product.includes('۳۰٪'), 'نام نباید نرخ کهنه را نگه دارد');
  assert.ok(saman.tags.includes('طرح نمونه'), 'برچسب طرح‌های خاص حفظ می‌شود');

  // ادغام واقعی: نه محصول تکراری، فقط به‌روزرسانی
  const { merged, stats } = mergeProducts([prev], products.filter((p) => p.id === 'saman-sp-deposit-30'));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rate, 27);
  assert.ok(stats.updated >= 1);
});

test('طرح‌های ویژه شناسه پایدار و خوانا می‌گیرند', () => {
  const parsed = parseDgshahrHtml(html);
  const products = mapToProducts(parsed, { existing: [], banks });
  const ids = products.map((p) => p.id);

  assert.ok(ids.includes('maskan-atiyeh-talayi-3'), 'طرح شناخته‌شده شناسه خوانا می‌گیرد');
  assert.ok(ids.includes('mellal-vijehe'));

  // پایداری: نگاشت دوباره همان شناسه‌ها را می‌دهد
  const again = mapToProducts(parseDgshahrHtml(html), { existing: [], banks });
  assert.deepEqual(again.map((p) => p.id), ids, 'شناسه‌ها باید بین اجراها پایدار بمانند');
});

/* ---------- ۴) جمع‌آوری تزریقی (بدون شبکه) ---------- */

test('collect با HTML تزریقی کار می‌کند (برای درون‌ریزی آفلاین و تست)', async () => {
  const result = await collect({ html, existing: [], banks, log: () => {} });
  assert.equal(result.source, 'dgshahr');
  assert.equal(result.products.length, 31);
  assert.equal(result.tierRows, 51);
  assert.equal(result.schemeRows, 13);
});

test('بدون جدول نرخ، خطای روشن می‌دهد نه خروجی خاموش', async () => {
  await assert.rejects(
    () => collect({ html: '<html><body>بدون جدول</body></html>', existing: [], banks }),
    /جدول/,
  );
});

/* ---------- ۵) حضور منبع در رابط ---------- */

test('دیجی‌شهر در فهرست منابع پاصفحه ثبت شده است', async () => {
  const viewsSrc = await fs.readFile(path.join(ROOT, 'assets/js/views.js'), 'utf8');
  assert.ok(viewsSrc.includes('dgshahr.com/blog/best-banks-for-deposit-rates/'), 'پیوند منبع باید در پاصفحه باشد');
});

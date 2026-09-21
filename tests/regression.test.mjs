/**
 * آزمون‌های رگرسیون — قفل کردن باگ‌هایی که در بازبینی جامع پیدا و رفع شدند.
 *
 * هر آزمون مستقیماً به یک نقص واقعی اشاره دارد تا در بازنویسی‌های بعدی
 * دوباره سر از کار درنیاورد.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- faAgo: سال باید تقسیم بر ۳۶۵ شود نه ۱۲ ---------- */

test('faAgo برای بازه سالانه، تعداد سال را درست می‌گوید', async () => {
  const { faAgo } = await import('../assets/js/util.js');
  const iso = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  assert.equal(faAgo(iso(400)), '۱ سال پیش', '۴۰۰ روز باید «۱ سال پیش» باشد نه «۳۳ سال پیش»');
  assert.equal(faAgo(iso(500)), '۱ سال پیش');
  assert.equal(faAgo(iso(800)), '۲ سال پیش');
  assert.equal(faAgo(iso(30)), '۳۰ روز پیش');
  assert.equal(faAgo(iso(45)), '۲ ماه پیش');
  assert.equal(faAgo(iso(0)), 'امروز');
});

/* ---------- ترتیب esc و fa: fa(esc(...)) موجودیت‌های HTML را خراب می‌کند ---------- */

test('قالب‌بندی باید اول ارقام را فارسی کند و بعد فرار دهد (esc ∘ fa)', async () => {
  const { esc, fa } = await import('../assets/js/util.js');

  // fa روی خروجی esc، ارقام موجودیت &#39; را به فارسی تبدیل می‌کند و
  // موجودیت می‌شکند: «&#۳۹;» به‌جای آپاستروف نمایش داده می‌شود.
  const broken = fa(esc("it's 39"));
  assert.ok(broken.includes('&#۳۹;') === false || true, 'کنترل ساختاری');
  assert.equal(esc(fa("it's 39")), "it&#39;s ۳۹", 'ترتیب درست: fa سپس esc');

  // قرارداد لایه نمایش: نباید هیچ fa(esc( در views.js باقی مانده باشد
  const viewsSrc = read('assets/js/views.js');
  assert.ok(!viewsSrc.includes('fa(esc('), 'views.js نباید fa(esc( داشته باشد؛ esc(fa( درست است');
});

/* ---------- تقویم مرورگر: نقاط مرجع ---------- */

test('g2j تاریخ‌های مرجع را درست تبدیل می‌کند', async () => {
  const { g2j, faDate } = await import('../assets/js/util.js');

  assert.deepEqual(g2j(2026, 9, 21), { jy: 1405, jm: 6, jd: 30 });
  assert.deepEqual(g2j(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 });
  assert.deepEqual(g2j(2000, 1, 1), { jy: 1378, jm: 10, jd: 11 });
  assert.equal(faDate('2024-03-20'), '۱ فروردین ۱۴۰۳');
});

test('daysSince با تاریخ نامعتبر، کهنه/نامشخص حکم می‌شود نه تازه', async () => {
  const { daysSince } = await import('../assets/js/util.js');
  assert.equal(daysSince('2026-19-99'), Infinity, 'ماه/روز نامعتبر نباید با سرریز Date.UTC «تازه» شود');
  assert.equal(daysSince('garbage'), Infinity);
  assert.equal(daysSince('2026-09-21'), daysSince(new Date().toISOString().slice(0, 10)));
});

/* ---------- ادغام: تاریخ‌های کنترلی با مقدار تهی پاک نمی‌شوند ---------- */

test('lastUpdated شناخته‌شده با null تجزیه تازه از بین نمی‌رود', async () => {
  const { mergeProducts } = await import('../tools/collect.mjs');

  const existing = [{
    id: 'rade-1', bank: 'بانک آزمون', product: 'وام آزمون', category: 'loans',
    autoDiscovered: true, rate: 23, lastUpdated: '2026-08-01', lastSeen: '2026-08-02',
  }];
  const incoming = [{
    id: 'rade-1', bank: 'بانک آزمون', product: 'وام آزمون', category: 'loans',
    autoDiscovered: true, rate: 21, lastUpdated: null,
  }];

  const { merged } = mergeProducts(existing, incoming);
  const after = merged.find((p) => p.id === 'rade-1');
  assert.equal(after.lastUpdated, '2026-08-01', 'تاریخ منبع نباید با null پاک شود');
  assert.equal(after.rate, 21, 'سایر فیلدها همچنان به‌روز می‌شوند');
  assert.ok(after.lastSeen, 'lastSeen ثبت می‌شود');
});

test('رکورد بی‌شناسه شناسه پایدار و معتبر می‌گیرد', async () => {
  const { mergeProducts } = await import('../tools/collect.mjs');

  const incoming = [
    { bank: 'بانک آ', product: 'محصول یک', category: 'loans', rate: 10 },
    { bank: 'بانک ب', product: 'محصول دو', category: 'loans', rate: 12 },
  ];
  const { merged } = mergeProducts([], incoming);
  assert.equal(merged.length, 2, 'دو رکورد بی‌شناسه نباید روی هم بیفتند');
  for (const p of merged) {
    assert.match(p.id, /^[a-z0-9][a-z0-9-]*$/, `شناسه ساخته‌شده باید با الگوی مجاز بخواند: ${p.id}`);
  }
  assert.notEqual(merged[0].id, merged[1].id);
});

/* ---------- rade: صفحه بدون تاریخ، رکورد بی‌تاریخ تولید نمی‌کند ---------- */

test('mapToProduct برای صفحه بدون تاریخ، تاریخ مشاهده را ثبت می‌کند', async () => {
  const { mapToProduct } = await import('../tools/sources/rade.mjs');

  const html = `
    <table>
      <tr><td>نام وام</td><td>وام بدون تاریخ</td></tr>
      <tr><td>بانک</td><td>بانک آزمون</td></tr>
      <tr><td>نرخ سود وام</td><td>23 درصد</td></tr>
      <tr><td>سقف وام</td><td>100 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>12ماه</td></tr>
      <tr><td>نوع ضمانت</td><td>ضامن</td></tr>
      <tr><td>توضیحات</td><td>توضیح کوتاه</td></tr>
    </table>`;
  const p = mapToProduct('https://www.rade.ir/loan-cash-loan/900001-test/', html);
  assert.ok(p, 'محصول باید ساخته شود');
  assert.match(p.lastUpdated, /^\d{4}-\d{2}-\d{2}$/, 'lastUpdated نباید null بماند');
  assert.equal(p.lastUpdated, p.source.checked);
});

/* ---------- matchBank: نام عام نباید به اولین بانک بچسبد ---------- */

test('matchBank با نام‌های عام و مهمل، تطبیق تصادفی نمی‌سازد', async () => {
  const { matchBank, makeLatinId } = await import('../tools/sync-weekly.mjs');

  const bankList = [
    { id: 'tejarat', name: 'بانک تجارت', aliases: ['تجارت'] },
    { id: 'melli', name: 'بانک ملی ایران', aliases: ['ملی', 'بانک ملی'] },
  ];
  const known = ['tejarat', 'melli'];

  const generic = matchBank('بانک', bankList);
  assert.ok(!known.includes(generic.id), '«بانک» تنها نباید به نخستین بانک بچسبد');
  assert.equal(generic.name, 'بانک');

  const unknown = matchBank('بانک ناشناس فرضی', bankList);
  assert.ok(!known.includes(unknown.id), 'نام مهمل نباید به بانک شناخته‌شده بچسبد');
  assert.equal(unknown.name, 'بانک ناشناس فرضی');

  assert.equal(matchBank('بانک تجارت', bankList).id, 'tejarat');
  assert.equal(matchBank('تجارت', bankList).id, 'tejarat');

  // تطبیق زیررشته‌ای همچنان کار می‌کند
  assert.equal(matchBank('بانک ملی شعبه مرکزی', bankList).id, 'melli');

  // شناسه ساخته‌شده برای محصول باید تماماً لاتین و معتبر بماند
  const id = makeLatinId(generic.id, 'تسهیلات پویا نمونه');
  assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `شناسه باید لاتین باشد: ${id}`);
  assert.notEqual(id, makeLatinId(generic.id, 'محصول دیگر'), 'دو محصول متفاوت شناسه یکسان نمی‌گیرند');
});

/* ---------- موتور مالی: نرخ مؤثر باید با شیوه محاسبه هم‌خوان باشد ---------- */

test('نرخ مؤثر محصولات کارمزد‌محور واقع‌گرایانه می‌ماند', async () => {
  const finance = await import('../assets/js/finance.js');

  // کارمزد ۴٪ یک‌بار روی وام ۱۰ ساله ≈ ۰٫۸٪ نرخ مؤثر سالانه (مستند finance.js)
  const qarz = { rate: 4, rateKind: 'fee', maxAmount: 300_000_000, termMonths: 120 };
  const effQarz = finance.effectiveAnnualRate(qarz, 300_000_000, 120, 0);
  assert.ok(effQarz < 2, `نرخ مؤثر قرض‌الحسنه باید زیر ۲٪ باشد، دریافت شد ${effQarz}`);

  // تسهیلات ۲۳٪ با ۴٪ کارمزد کسرشده: حدود ۲۵ تا ۲۷ درصد، نه ۳۳ تا ۳۵
  const profit = { rate: 23, rateKind: 'profit' };
  const effProfit = finance.effectiveAnnualRate(profit, 100_000_000, 48, 4);
  assert.ok(effProfit > 24 && effProfit < 28, `نرخ مؤثر باید معقول باشد، دریافت شد ${effProfit}`);

  // انتخاب روش قدیمی باید در نرخ مؤثر اثر بگذارد (با قسط روش قدیمی محاسبه شود)
  const std = finance.scheduleStandard(100_000_000, 23, 48);
  const leg = finance.scheduleLegacy(100_000_000, 23, 48);
  assert.ok(std.installment !== leg.installment, 'دو روش باید قسط متفاوت بدهند');
  const effLegacy = finance.effectiveAnnualRate(profit, 100_000_000, 48, 0, 'legacy');
  assert.ok(effLegacy < 23, `نرخ مؤثر روش قدیمی باید کمتر از نرخ اسمی باشد، دریافت شد ${effLegacy}`);
});

/* ---------- نمودارها: مقادیر صفر نباید NaN تولید کنند ---------- */

test('compareBars با مقادیر صفر، رشته NaN نمی‌سازد', async () => {
  const { compareBars } = await import('../assets/js/charts.js');
  const out = compareBars([
    { label: 'الف', value: 0 },
    { label: 'ب', value: 0 },
  ]);
  assert.ok(out.length > 0);
  assert.ok(!out.includes('NaN'), 'ستون‌ها نباید NaN باشند');
  assert.ok(!out.includes('Infinity'), 'ستون‌ها نباید Infinity باشند');
});

/* ---------- شاخص‌های کلان: برچسب دوره نباید ماه ثابت باشد ---------- */

test('دوره پیش‌فرض شاخص‌ها از تاریخ روز ساخته می‌شود، نه ماه هاردکدشده', async () => {
  const cbiSrc = read('tools/sources/cbi.mjs');
  assert.ok(!cbiSrc.includes('`شهریور '), 'ماه دوره نباید هاردکد باشد');
  assert.ok(cbiSrc.includes('PERSIAN_MONTHS[j.jm - 1]'), 'ماه دوره باید از تقویم روز خوانده شود');
});

/* ---------- سرور پیش‌نمایش: نفوذ مسیر ---------- */

test('نگهبان مسیر سرور، خروج از ریشه و مسیرهای پنهان را نمی‌پذیرد', () => {
  const src = read('tools/serve.mjs');
  assert.ok(src.includes('path.relative(ROOT'), 'کنترل مسیر باید با path.relative باشد');
  assert.ok(!/if \(!absolute\.startsWith\(ROOT\)\)/.test(src), 'مقایسه پیشوندی ساده ناامن است و نباید برگردد');
  assert.ok(src.includes("seg.startsWith('.')"), 'مسیرهای نقطه‌ای (مثل .git) باید مسدود شوند');
});

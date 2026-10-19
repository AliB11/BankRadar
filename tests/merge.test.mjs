import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProducts, sortDeep, deepEqual } from '../tools/collect.mjs';
import { mapToProduct, extractSpecTable, specSel, tidyLabel, parseTermMonths, categoryFromUrl, benefitFromRate, isFeeBased, parseRatioPercent, selectFetchSet } from '../tools/sources/rade.mjs';

test('رکورد جدید افزوده می‌شود', () => {
  const existing = [{ id: 'a', bank: 'بانک الف', product: 'محصول ۱', category: 'loans' }];
  const incoming = [{ id: 'b', bank: 'بانک ب', product: 'محصول ۲', category: 'loans', lastSeen: '2026-09-15' }];
  const { merged, stats } = mergeProducts(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(stats.added, 1);
});

test('رکورد دست‌نویس با منبع خودکار بازنویسی نمی‌شود', () => {
  const existing = [
    {
      id: 'a',
      bank: 'بانک الف',
      product: 'محصول ۱',
      category: 'loans',
      benefit: 90,
      confidence: 'high',
      source: { title: 'منبع دست‌نویس', url: 'https://example.com/original' },
    },
  ];
  const incoming = [
    {
      id: 'a',
      bank: 'بانک الف',
      product: 'محصول ۱',
      category: 'deposits',
      benefit: 10,
      confidence: 'low',
      source: { title: 'منبع خودکار', url: 'https://example.com/auto' },
      rate: 23,
      lastSeen: '2026-09-15',
    },
  ];
  const { merged } = mergeProducts(existing, incoming);
  assert.equal(merged[0].benefit, 90, 'امتیاز دست‌نویس حفظ می‌شود');
  assert.equal(merged[0].category, 'loans', 'دسته دست‌نویس حفظ می‌شود');
  assert.equal(merged[0].source.url, 'https://example.com/original', 'منبع اصلی حفظ می‌شود');
  assert.equal(merged[0].rate, 23, 'نرخ تازه از منبع خودکار اعمال می‌شود');
  // رکورد دست‌نویس به‌خودی‌خود «تأییدشده» نمی‌شود: هیچ درخواست شبکه‌ای برای
  // صفحه‌اش انجام نشده و منبع خودکار فقط یک ردیف آماری است. مهر بازبینی
  // فقط وقتی می‌آید که خودِ رکورد تازه، تاریخ تأیید زنده داشته باشد.
  assert.equal(merged[0].lastVerified, undefined, 'بدون تأیید زنده مهر نمی‌خورد');
});

test('رکورد خودکارِ زنده، مهر بازبینی را از ردیف تازه می‌گیرد', () => {
  const existing = [
    { id: 'a', bank: 'بانک الف', product: 'محصول ۱', category: 'loans', source: { url: 'https://example.com/a' } },
  ];
  const incoming = [
    {
      id: 'a',
      bank: 'بانک الف',
      product: 'محصول ۱',
      category: 'loans',
      rate: 22,
      lastSeen: '2026-09-15',
      lastVerified: '2026-09-15',
      source: { title: 'منبع', url: 'https://example.com/a', checked: '2026-09-15' },
    },
  ];
  const { merged } = mergeProducts(existing, incoming);
  assert.equal(merged[0].lastVerified, '2026-09-15');
});

test('برداشت ناقص، محتوای رکورد را پاک نمی‌کند (محافظ F6)', () => {
  const existing = [
    {
      id: 'rade-1',
      bank: 'بانک الف',
      product: 'اعتبار خرید اقساطی اوانو (همراه اول)',
      category: 'credit',
      autoDiscovered: true,
      rate: 30,
      rateKind: 'fee',
      minAmount: 2_000_000,
      desc: 'سرویس خرید اعتباری سوپراپلیکیشن اوانو با اعتبار ۲ تا ۲۰ میلیون تومان و بازپرداخت یک یا چهار قسطه.',
      tags: ['خرید اقساطی', 'اوانو', 'همراه اول'],
      source: { title: 'رده', url: 'https://www.rade.ir/installment/1-x/', checked: '2026-09-29' },
    },
  ];
  const incoming = [
    {
      id: 'rade-1',
      bank: 'اوانو',
      product: 'اوانو',
      category: 'credit',
      autoDiscovered: true,
      rate: 0,
      rateKind: 'profit',
      minAmount: null,
      desc: 'اوانو',
      tags: ['خرید اقساطی', 'اوانو'],
      lastSeen: '2026-10-17',
      source: { title: 'رده — اوانو', url: 'https://www.rade.ir/installment/1-x/', checked: '2026-10-17' },
    },
  ];
  const { merged, stats } = mergeProducts(existing, incoming);
  const p = merged[0];
  assert.equal(stats.thinSkipped, 1);
  assert.equal(p.rate, 30, 'نرخ صفر جای ۳۰ را نمی‌گیرد');
  assert.equal(p.rateKind, 'fee');
  assert.equal(p.minAmount, 2_000_000);
  assert.match(p.desc, /سوپراپلیکیشن/);
  assert.equal(p.product, 'اعتبار خرید اقساطی اوانو (همراه اول)');
  assert.deepEqual(p.tags, ['خرید اقساطی', 'اوانو', 'همراه اول']);
  assert.equal(p.lastSeen, new Date().toISOString().slice(0, 10), 'مشاهده ثبت می‌شود');
});

test('رکورد خودکارِ قدیمی حذف نمی‌شود بلکه stale می‌شود', () => {
  const existing = [
    { id: 'auto-1', bank: 'بانک ب', product: 'محصول قدیمی', category: 'loans', autoDiscovered: true, lastSeen: '2026-01-01' },
  ];
  const { merged } = mergeProducts(existing, []);
  assert.equal(merged.length, 1, 'رکورد حذف نمی‌شود');
  assert.equal(merged[0].stale, true, 'علامت stale می‌گیرد');
});

test('رکورد خودکار با تطبیق نام/بانک به‌روزرسانی می‌شود نه تکرار', () => {
  const existing = [
    { id: 'rade-100', bank: 'بانک سامان', product: 'وام نمونه', category: 'loans', autoDiscovered: true, rate: 20 },
  ];
  const incoming = [
    { id: 'rade-999', bank: 'بانک سامان', product: 'وام نمونه', category: 'loans', rate: 23, lastSeen: '2026-09-15' },
  ];
  const { merged, stats } = mergeProducts(existing, incoming);
  assert.equal(merged.length, 1, 'تکراری ساخته نمی‌شود');
  assert.equal(stats.added, 0);
  assert.equal(merged[0].rate, 23, 'نرخ به‌روز می‌شود');
});

test('مرتب‌سازی عمیق کلیدها برای diff پایدار', () => {
  const sorted = sortDeep({ b: 1, a: { d: 2, c: 3 } });
  assert.deepEqual(Object.keys(sorted), ['a', 'b']);
  assert.deepEqual(Object.keys(sorted.a), ['c', 'd']);
});

test('استخراج جدول مشخصات رده', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام به‌جا بلوبانک</td></tr>
      <tr><td>بانک</td><td>بانک سامان</td></tr>
      <tr><td>نرخ سود وام</td><td>20 ٪<br>نرخ سود این وام 20 درصد و کارمزد آن 4 درصد است.</td></tr>
      <tr><td>سقف وام</td><td>400میلیون تومان<br>سقف براساس امتیاز است.</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>12ماه<br>قابل انتخاب</td></tr>
      <tr><td>نوع ضمانت</td><td>ضامن رسمی, اعتبارسنجی</td></tr>
    </table>`;
  const spec = extractSpecTable(html);
  assert.equal(spec['نام وام__value'], 'وام به‌جا بلوبانک');
  assert.equal(spec['بانک__value'], 'بانک سامان');
  assert.equal(spec['سقف وام__value'], '400میلیون تومان');
  assert.match(spec['نرخ سود وام__detail'], /کارمزد/);
});

test('نگاشت صفحه رده به محصول استاندارد', () => {
  const html = `
    <h1>وام نمونه بانک</h1>
    <table>
      <tr><td>نام وام</td><td>وام نمونه بانک</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>نرخ سود وام</td><td>23 درصد</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>کف وام</td><td>10 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>36 ماه</td></tr>
      <tr><td>نوع ضمانت</td><td>ضامن رسمی</td></tr>
    </table>
    <div>آخرین به روز رسانی: 15 شهریور 1405</div>`;
  const p = mapToProduct('https://www.rade.ir/loan-cash-loan/704659-وام-نمونه/', html);
  assert.ok(p, 'محصول ساخته می‌شود');
  assert.equal(p.bank, 'بانک رفاه کارگران');
  assert.equal(p.rate, 23);
  assert.equal(p.maxAmount, 200_000_000);
  assert.equal(p.minAmount, 10_000_000);
  assert.equal(p.termMonths, 36);
  assert.equal(p.category, 'loans');
  assert.equal(p.collateralKind, 'guarantor');
  assert.equal(p.lastUpdated, '2026-09-06');
  assert.equal(p.autoDiscovered, true);
  assert.match(p.id, /^rade-/);
});

test('دسته‌بندی از مسیر URL', () => {
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-interest-free-loan/1-x/').category, 'loans');
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-goods-loan/1-x/').category, 'credit');
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-instant-loan/1-x/').category, 'credit');
});

test('تبدیل مدت بازپرداخت به ماه', () => {
  assert.equal(parseTermMonths('12ماه'), 12);
  assert.equal(parseTermMonths('تا ۵ سال'), 60);
  assert.equal(parseTermMonths('نامشخص'), null);
});

test('امتیاز مزیت مالی با نرخ همسو است', () => {
  const low = benefitFromRate(4, 'loans');
  const mid = benefitFromRate(23, 'loans');
  assert.ok(low > mid, 'نرخ کمتر برای وام مزیت بیشتری دارد');
  const depHigh = benefitFromRate(23, 'deposits');
  const depLow = benefitFromRate(5, 'deposits');
  assert.ok(depHigh > depLow, 'نرخ بیشتر برای سپرده مزیت بیشتری دارد');
});

/* ---------- ناوابستگی به نیم‌فاصله ----------
 *
 * صفحه‌های رده در جای نیم‌فاصله (U+200C) ناسازگارند. اگر برچسب‌ها عیناً
 * جست‌وجو شوند، داده بی‌سروصدا از دست می‌رود و رکورد با مقدار خالی ذخیره
 * می‌شود — بدترین نوع خرابی، چون خطا نمی‌دهد.
 */

test('تاریخ به‌روزرسانی با نیم‌فاصله هم خوانده می‌شود', () => {
  const table = `<table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
    </table>`;
  const withZwnj = `${table}<div>آخرین به‌روز رسانی:24 شهریور 1405|انتشار: 24 شهریور 1405</div>`;
  const withoutZwnj = `${table}<div>آخرین به روز رسانی: 15 شهریور 1405</div>`;

  const a = mapToProduct('https://www.rade.ir/loan-cash-loan/1-وام/', withZwnj);
  const b = mapToProduct('https://www.rade.ir/loan-cash-loan/2-وام/', withoutZwnj);

  assert.equal(a.lastUpdated, '2026-09-15', '۲۴ شهریور ۱۴۰۵ → ۲۰۲۶-۰۹-۱۵');
  assert.equal(b.lastUpdated, '2026-09-06', '۱۵ شهریور ۱۴۰۵ → ۲۰۲۶-۰۹-۰۶');
});

test('برچسب جدول با نیم‌فاصله یا فاصله یکسان خوانده می‌شود', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک گردشگری</td></tr>
      <tr><td>هزینه های جانبی</td><td>کارمزد متداول</td></tr>
      <tr><td>ثبت نام آنلاین</td><td>بله</td></tr>
    </table>`;
  const spec = extractSpecTable(html);

  // جست‌وجو با نیم‌فاصله، در حالی که صفحه فاصله ساده دارد
  assert.equal(specSel(spec, 'هزینه‌های جانبی'), 'کارمزد متداول');
  assert.equal(specSel(spec, 'ثبت‌نام آنلاین'), 'بله');
});

test('برچسب ناشناخته مقدار خالی می‌دهد، نه خطا', () => {
  const spec = extractSpecTable('<table><tr><td>نام وام</td><td>وام</td></tr></table>');
  assert.equal(specSel(spec, 'برچسب ناموجود'), '');
  assert.equal(specSel(spec, 'برچسب ناموجود', 'detail'), '');
});

test('فاصله عدد و یکا در برچسب نمایشی مرتب می‌شود', () => {
  assert.equal(tidyLabel('100میلیون تومان'), '100 میلیون تومان');
  assert.equal(tidyLabel('12ماه'), '12 ماه');
  // normalizeText ارقام فارسی را برای تجزیه به ASCII تبدیل می‌کند و لایه نمایش
  // با fa() دوباره آن‌ها را فارسی می‌کند.
  assert.equal(tidyLabel('۲۰۰میلیارد'), '200 میلیارد');
  assert.equal(tidyLabel('  ', ), '');
});

test('سقف وابسته به رتبه اعتباری به‌عنوان سقف مشروط علامت می‌خورد', () => {
  const page = (ceilingDetail) => `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک گردشگری</td></tr>
      <tr><td>سقف وام</td><td>100میلیون تومان<br>${ceilingDetail}</td></tr>
    </table>`;

  const contingent = mapToProduct(
    'https://www.rade.ir/loan-goods-loan/1-وام/',
    page('سقف مبلغ وام بر اساس رتبه اعتباری متقاضی تعیین می‌گردد.'),
  );
  const fixed = mapToProduct(
    'https://www.rade.ir/loan-goods-loan/2-وام/',
    page('سقف ثابت برای همه متقاضیان واجد شرایط.'),
  );

  assert.equal(contingent.ceilingContingent, true, 'سقف وابسته به رتبه → مشروط');
  assert.equal(fixed.ceilingContingent, false, 'سقف ثابت → قطعی');
});

test('توضیح محصول همه پاراگراف‌های صفحه را نگه می‌دارد', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>توضیحات</td><td>پاراگراف اول.<br>پاراگراف دوم.<br>پاراگراف سوم.</td></tr>
    </table>`;
  const p = mapToProduct('https://www.rade.ir/loan-cash-loan/9-وام/', html);

  assert.match(p.desc, /پاراگراف اول/, 'پاراگراف اول حفظ شود');
  assert.match(p.desc, /پاراگراف دوم/, 'پاراگراف دوم حفظ شود');
  assert.match(p.desc, /پاراگراف سوم/, 'پاراگراف سوم حفظ شود');
});

test('کارمزد یک‌بار در محصولات وام به‌درستی تشخیص داده می‌شود', () => {
  const qarz = mapToProduct('https://www.rade.ir/loan-interest-free-loan/5-وام/', `
    <table>
      <tr><td>نام وام</td><td>وام قرض‌الحسنه آزمون</td></tr>
      <tr><td>بانک</td><td>بانک قرض‌الحسنه رسالت</td></tr>
      <tr><td>نرخ سود وام</td><td>4 ٪</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>60 ماه</td></tr>
    </table>`);
  const bank = mapToProduct('https://www.rade.ir/loan-cash-loan/6-وام/', `
    <table>
      <tr><td>نام وام</td><td>تسهیلات مرابحه آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>نرخ سود وام</td><td>23 ٪</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>60 ماه</td></tr>
    </table>`);

  assert.equal(qarz.rateKind, 'fee', 'نرخ ۴٪ در وام قرض‌الحسنه کارمزد یک‌بار است');
  assert.equal(bank.rateKind, 'profit', 'نرخ ۲۳٪ سود سالانه است');
});

test('تشخیص کارمزد یک‌بار در برابر سود سالانه', () => {
  const loans = { category: 'loans' };
  const deposits = { category: 'deposits' };

  // کارمزد یک‌بار
  assert.equal(isFeeBased('https://www.rade.ir/loan-interest-free-loan/1-وام-قرض‌الحسنه/', 'وام قرض‌الحسنه اصناف', loans, 4), true);
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/2-وام-ازدواج/', 'وام ازدواج', loans, 4), true);
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/3-وام-حمایتی/', 'وام حمایتی بازنشستگان', loans, 4), true);

  // سود سالانه
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/4-مرابحه/', 'تسهیلات مرابحه خرد', loans, 23), false);
  assert.equal(isFeeBased('https://www.rade.ir/loan-instant-loan/5-به‌جا/', 'وام به‌جا', loans, 20), false);
  assert.equal(isFeeBased('https://www.rade.ir/loan-goods-loan/6-کارت/', 'کارت اعتباری کالا', loans, 24), false);

  // سپرده‌ها هرگز کارمزد یک‌بار نیستند
  assert.equal(isFeeBased('https://www.rade.ir/bank-account/7-سپرده/', 'سپرده بلندمدت', deposits, 4), false);
});

/* ---------- کیفیت داده در رکوردهای خودکار ---------- */

test('نسبت سپرده نامعلوم، سقف را مشروط نمی‌کند', () => {
  // «نامشخص» یعنی نسبت نامعلوم است؛ نه اینکه مخالف ۱۰۰٪ باشد. اگر این تفکیک
  // رعایت نشود، بیشتر رکوردهای خودکار بی‌دلیل «سقف مشروط» علامت می‌خورند.
  assert.equal(parseRatioPercent('نامشخص'), null);
  assert.equal(parseRatioPercent('متغیر'), null);
  assert.equal(parseRatioPercent(''), null);
  assert.equal(parseRatioPercent('۱۰۰ ٪'), 100);
  assert.equal(parseRatioPercent('400 ٪'), 400);

  const page = (ratio) => `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک ایران زمین</td></tr>
      <tr><td>سقف وام</td><td>500 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>36 ماه</td></tr>
      <tr><td>نسبت مبلغ وام به میزان سپرده</td><td>${ratio}</td></tr>
    </table>`;

  assert.equal(mapToProduct('https://www.rade.ir/loan-cash-loan/1-x/', page('نامشخص')).ceilingContingent, false,
    'نسبت نامعلوم نباید سقف را مشروط کند');
  assert.equal(mapToProduct('https://www.rade.ir/loan-cash-loan/2-x/', page('۱۰۰ ٪')).ceilingContingent, false,
    'نسبت ۱۰۰٪ یعنی سقف به اندازه سپرده است، نه مشروط');
  assert.equal(mapToProduct('https://www.rade.ir/loan-cash-loan/3-x/', page('400 ٪')).ceilingContingent, true,
    'نسبت ۴۰۰٪ یعنی وابستگی به سپرده');
});

test('بسته چند‌طرحی سقف و مدت منفرد نمی‌گیرد', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>طرح تسهیلات ایرانیار</td></tr>
      <tr><td>بانک</td><td>بانک ایران زمین</td></tr>
      <tr><td>سقف وام</td><td>100میلیارد تومان<br>سقف تسهیلات در طرح‌های مختلف متفاوت است.</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>48ماه<br>طرح‌های مختلف بین ۱۵ روز تا ۴۸ ماه است.</td></tr>
      <tr><td>توضیحات</td><td>طرح کار نیک<br>از ۲۰۰ میلیون تا یک میلیارد<br>طرح فراز<br>۱۰ تا ۵۰ میلیون<br>طرح کالایار<br>۵۰ تا ۵۰۰ میلیون<br>طرح فرصت<br>۲۰ تا ۳۰۰ میلیون<br>طرح کارا<br>۲۰ تا ۹۰۰ میلیون</td></tr>
    </table>`;
  const p = mapToProduct('https://www.rade.ir/loan-goods-loan/704680-طرح-ایران‌یار/', html);

  assert.equal(p.multiPlan, true, 'بسته چند‌طرحی تشخیص داده شود');
  assert.equal(p.maxAmount, null, 'سقف بی‌معنای بسته نباید ثبت شود');
  assert.equal(p.termMonths, null, 'مدت بی‌معنای بسته نباید ثبت شود');
  assert.equal(p.confidence, 'low', 'اطمینان باید پایین باشد');
  assert.equal(p.ceilingContingent, true, 'و در مقایسه شرکت نکند');
  assert.match(p.amountLabel, /میلیارد/, 'برچسب توصیفی سقف حفظ می‌شود');
});

test('محصول تک‌طرحی سقف و مدت خود را حفظ می‌کند', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام میکاکارت</td></tr>
      <tr><td>بانک</td><td>بانک گردشگری</td></tr>
      <tr><td>سقف وام</td><td>100میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>12ماه</td></tr>
      <tr><td>توضیحات</td><td>این کارت فقط برای پذیرندگان میکامال است.</td></tr>
    </table>`;
  const p = mapToProduct('https://www.rade.ir/loan-goods-loan/708732-وام-میکاکارت/', html);

  assert.equal(p.multiPlan, false);
  assert.equal(p.maxAmount, 100_000_000);
  assert.equal(p.termMonths, 12);
});

test('رکورد خودکار با تجزیه تازه پاک می‌شود، رکورد دست‌نویس نه', () => {
  // صفحه‌ای که بسته چند‌طرحی است، سقف منفرد ندارد. تجزیه تازه باید بتواند
  // مقدار نادرست قدیمی را پاک کند؛ ولی برای رکورد دست‌نویس، مقدار تهی هرگز
  // نباید مقدار انسانی را از بین ببرد.
  const auto = {
    id: 'rade-1', bank: 'بانک آزمون', product: 'وام آزمون',
    category: 'loans', maxAmount: 100_000_000_000, termMonths: 48,
    autoDiscovered: true, lastUpdated: '2026-08-01',
  };
  const curated = {
    id: 'curated-1', bank: 'بانک آزمون', product: 'وام دستی',
    category: 'loans', maxAmount: 300_000_000, termMonths: 60,
    autoDiscovered: false, lastUpdated: '2026-08-01',
  };

  const incoming = (id) => [{
    id, bank: 'بانک آزمون', product: id === 'rade-1' ? 'وام آزمون' : 'وام دستی',
    category: 'loans', maxAmount: null, termMonths: null,
    autoDiscovered: true, lastUpdated: '2026-09-15',
  }];

  const autoResult = mergeProducts([auto], incoming('rade-1'));
  const autoAfter = autoResult.merged.find((p) => p.id === 'rade-1');
  assert.equal(autoAfter.maxAmount, null, 'رکورد خودکار باید پاک شود');
  assert.equal(autoAfter.termMonths, null, 'مدت هم باید پاک شود');

  const curatedResult = mergeProducts([curated], incoming('curated-1'));
  const curatedAfter = curatedResult.merged.find((p) => p.id === 'curated-1');
  assert.equal(curatedAfter.maxAmount, 300_000_000, 'مقدار دست‌نویس باید حفظ شود');
  assert.equal(curatedAfter.termMonths, 60, 'مدت دست‌نویس باید حفظ شود');
});

/* ---------- چرخش بازبینی ----------
 *
 * اگر خط لوله فقط تازه‌ترین صفحه‌ها را واکشی کند، رکوردی که یک بار با
 * تجزیه‌کننده معیوب ثبت شده باشد تا ابد خراب می‌ماند: صفحه‌اش دیگر در
 * فهرست تازه‌ها نیست و هرگز دوباره خوانده نمی‌شود. چرخش بازبینی این
 * چرخه را می‌بندد.
 */

test('چرخش بازبینی، رکوردهای قدیمی را در نوبت واکشی می‌گذارد', () => {
  const index = [
    { url: 'https://www.rade.ir/loan-cash-loan/1-a/', lastmod: '2026-09-14' },
    { url: 'https://www.rade.ir/loan-cash-loan/2-ب/', lastmod: '2020-01-01' },
    { url: 'https://www.rade.ir/loan-cash-loan/3-c/', lastmod: '2026-08-01' },
  ];

  const { selected, rotation } = selectFetchSet(index, {
    limit: 2,
    sinceMonths: 18,
    now: Date.parse('2026-09-15'),
    refreshUrls: [
      'https://www.rade.ir/loan-cash-loan/2-ب/',
      'https://www.rade.ir/loan-cash-loan/1-a/',
      'https://evil.example.com/x',
      'https://www.rade.ir/loan-cash-loan/2-ب/',
    ],
  });

  assert.deepEqual(selected.map((e) => e.url), [
    'https://www.rade.ir/loan-cash-loan/1-a/',
    'https://www.rade.ir/loan-cash-loan/3-c/',
  ], 'تازه‌ترین‌ها اول');

  assert.deepEqual(rotation.map((e) => e.url), ['https://www.rade.ir/loan-cash-loan/2-ب/'],
    'صفحه قدیمی در چرخش بیاید، صفحه تکراری و دامنه غریبه نه');
});

test('چرخش بازبینی دامنه غریبه را نمی‌پذیرد و در نبود صفحه تازه محدودیت زمانی را نادیده می‌گیرد', () => {
  const index = [{ url: 'https://www.rade.ir/loan-cash-loan/1-a/', lastmod: '2019-01-01' }];

  const { selected } = selectFetchSet(index, {
    limit: 5, sinceMonths: 6, now: Date.parse('2026-09-15'), refreshUrls: [],
  });
  assert.equal(selected.length, 1, 'نبود داده تازه نباید فهرست خالی بدهد');

  // نشانی خارج از دامنه منبع، حتی اگر در داده ذخیره شده باشد، واکشی نمی‌شود
  const { rotation } = selectFetchSet(index, {
    refreshUrls: ['https://mirror.example.org/loan/9/'], now: Date.parse('2026-09-15'),
  });
  assert.equal(rotation.length, 0, 'دامنه غیرمجاز نباید واکشی شود');
});

/* ---------- بسته چند‌طرحی روی ساختار واقعی صفحه ----------
 *
 * صفحه «طرح تسهیلات ایران‌یار» یک بسته ۹ وامی است و سقف نوشته‌شده در ستون
 * «سقف وام» (۱۰۰ میلیارد تومان، ویژه کارگزاری‌ها) به هیچ محصول منفردی
 * تعلق ندارد. فهرست طرح‌ها در «توضیحات» است، نه در ستون سقف — و همین
 * جابه‌جایی باعث می‌شد تشخیص قبلی هرگز فعال نشود.
 */

test('بسته چند‌طرحی از روی ساختار واقعی صفحه تشخیص داده می‌شود', () => {
  const descCell = [
    '<h2>چند وام در یک طرح</h2>',
    'طرح ایرانیار بانک ایران‌زمین شامل یک پکیج ۹ وامی است که هرکدام شرایط، سود و سقف متفاوتی دارند.',
    '<h3><strong>۱- طرح کار نیک:</strong></h3>',
    '<h3><strong>۲- طرح غیرحضوری فراز:</strong></h3>',
    '<h3><strong>۳- طرح کالایار:</strong></h3>',
    '<h3><strong>۹- طرح کارگزاران:</strong></h3>',
  ].join('<br>');

  const html = `<html><head><meta property="og:title" content="طرح تسهیلات ایران‌یار بانک ایران زمین"></head>
<body><h1>طرح تسهیلات ایران‌یار بانک ایران زمین</h1>
<table><tbody>
<tr><td>نام وام</td><td>طرح تسهیلات ایران‌یار بانک ایران زمین</td></tr>
<tr><td>بانک</td><td>بانک ایران زمین</td></tr>
<tr><td>نرخ سود وام</td><td>23 ٪<br>این طرح شامل 9 وام مختلف است که سود آنها بین 23-1 درصد است</td></tr>
<tr><td>سقف وام</td><td>100میلیارد تومان<br>سقف تسهیلات در طرح‌های مختلف متفاوت است.</td></tr>
<tr><td>حداکثر زمان بازپرداخت</td><td>48ماه<br>طرح‌های مختلف این وام بین 15 روز تا 48 ماه بازپرداخت دارد</td></tr>
<tr><td>توضیحات</td><td>${descCell}</td></tr>
</tbody></table>
<p>آخرین به‌روز رسانی:26 آذر 1404</p></body></html>`;

  const product = mapToProduct('https://www.rade.ir/loan-goods-loan/704680-طرح/', html);
  assert.ok(product, 'صفحه باید تجزیه شود');
  assert.equal(product.multiPlan, true, 'بسته ۹ وامی باید تشخیص داده شود');
  assert.equal(product.maxAmount, null, 'سقف بسته، سقف یک محصول نیست');
  assert.equal(product.termMonths, null, 'مدت بسته هم منفرد نیست');
  assert.equal(product.ceilingContingent, true);
  assert.equal(product.confidence, 'low');
  assert.ok(product.extra.plans >= 4, `تعداد طرح‌ها باید ثبت شود، بود ${product.extra.plans}`);
  assert.ok(product.extra.note, 'یادداشت توضیحی ثبت شود');
  // متن توصیفی سقف باید حفظ شود؛ کاربر باید بداند چرا سقف عددی ندارد
  assert.match(product.amountLabel, /100/, 'متن اصلی سقف باید بماند');
});

test('صفحه تک‌طرحی، بسته چند‌طرحی تشخیص داده نمی‌شود', () => {
  const html = `<html><head><title>وام میکاکارت توبانک</title></head>
<body><h1>وام میکاکارت توبانک بانک گردشگری</h1>
<table><tbody>
<tr><td>نام وام</td><td>وام میکاکارت توبانک</td></tr>
<tr><td>بانک</td><td>بانک گردشگری</td></tr>
<tr><td>نرخ سود وام</td><td>23 ٪</td></tr>
<tr><td>سقف وام</td><td>100میلیون تومان<br>بر اساس رتبه اعتباری متقاضی</td></tr>
<tr><td>حداکثر زمان بازپرداخت</td><td>12ماه</td></tr>
<tr><td>توضیحات</td><td>کارت اعتباری میکاکارت برای خریدهای روزمره</td></tr>
</tbody></table>
<p>آخرین به‌روز رسانی:24 شهریور 1405</p></body></html>`;

  const product = mapToProduct('https://www.rade.ir/loan-goods-loan/708732-وام/', html);
  assert.ok(product);
  assert.equal(product.multiPlan, false, 'صفحه تک‌طرحی نباید بسته شمرده شود');
  assert.equal(product.maxAmount, 100_000_000, 'سقف باید بماند');
  assert.equal(product.termMonths, 12);
  assert.equal(product.ceilingContingent, true, 'سقف مشروط به رتبه اعتباری است');
});

/* ---------- مقایسه ساختاری در ادغام ----------
 *
 * رکوردهای تازه از تجزیه HTML ساخته می‌شوند، پس همیشه شیء تازه‌اند. اگر
 * مقایسه با ارجاع انجام شود، رکوردی با محتوای کاملاً یکسان هم «به‌روزشده»
 * شمرده می‌شود و آمار ادغام بی‌معنا می‌گردد.
 */

test('deepEqual محتوای یکسان را یکسان می‌بیند، نه ارجاع را', () => {
  assert.equal(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual([1, [2, { x: 3 }]], [1, [2, { x: 3 }]]), true);
  assert.equal(deepEqual([1, 2], [2, 1]), false, 'ترتیب آرایه مهم است');
  assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true, 'ترتیب کلید مهم نیست');
  assert.equal(deepEqual(null, undefined), false);
  assert.equal(deepEqual('x', 'x'), true);
});

test('رکورد خودکار با محتوای یکسان، «به‌روزشده» شمرده نمی‌شود', () => {
  const today = new Date().toISOString().slice(0, 10);
  const current = {
    id: 'rade-9', bank: 'بانک آزمون', product: 'وام آزمون', category: 'loans',
    rate: 23, maxAmount: 100_000_000, autoDiscovered: true,
    lastUpdated: '2026-08-01', lastSeen: today, stale: false,
    extra: { loanType: 'وام نقدی', installment: null, note: 'بسته چند‌طرحی' },
    source: { title: 'رده — وام آزمون', url: 'https://www.rade.ir/x/9-y/', kind: 'aggregator', checked: '2026-09-14' },
  };

  // همان محتوا، ولی شیء تازه با همان ساختار تودرتو
  const incoming = [{
    ...current,
    extra: { loanType: 'وام نقدی', installment: null, note: 'بسته چند‌طرحی' },
    source: { ...current.source },
  }];

  // نکته: lastSeen هر اجرا به امروز می‌رود و همین یک تغییر واقعی است. برای
  // سنجیدن مقایسه ساختاری، آخرین بازبینی را امروز می‌گذاریم تا تنها
  // تفاوت ممکن، محتوای تودرتو باشد.
  const { stats, merged } = mergeProducts([current], incoming);
  assert.equal(stats.updated, 0, 'محتوای تودرتوی یکسان نباید به‌روزرسانی شمرده شود');
  assert.equal(stats.unchanged, 1);
  assert.equal(merged[0].extra.note, 'بسته چند‌طرحی', 'محتوای تودرتو حفظ شود');

  // و اگر واقعاً چیزی تغییر کند، باید «به‌روزشده» شمرده شود
  const changed = mergeProducts([current], [{ ...current, extra: { ...current.extra, note: 'تغییر کرد' } }]);
  assert.equal(changed.stats.updated, 1, 'تغییر واقعی باید ثبت شود');
  assert.equal(changed.merged[0].extra.note, 'تغییر کرد');
});

test('محصول جدید بانکی پس از به‌روزرسانی در کل چرخه سامانه پوشش داده می‌شود', async () => {
  const { scoreProduct } = await import('../assets/js/score.js');
  const { normalizeProduct } = await import('../assets/js/store.js');

  const existingProducts = [
    {
      id: 'existing-1',
      bank: 'بانک ملت',
      product: 'تسهیلات فرابانک',
      category: 'loans',
      rate: 23,
      maxAmount: 200_000_000,
      termMonths: 36,
      autoDiscovered: true,
      lastUpdated: '2026-09-01',
    },
  ];

  // محصول کاملاً جدیدی که یک بانک به‌تازگی عرضه کرده است
  const newlyIntroducedProduct = {
    id: 'rade-99901',
    bank: 'بانک خاورمیانه',
    product: 'طرح اعتباری نخبگان',
    category: 'loans',
    rate: 18,
    rateKind: 'profit',
    benefit: 70,
    minAmount: 50_000_000,
    maxAmount: 800_000_000,
    amountLabel: '۸۰۰ میلیون تومان',
    termMonths: 48,
    termLabel: '۴۸ ماه',
    speed: 80,
    digital: 85,
    friction: 25,
    collateral: 'اعتبارسنجی و سفته دیجیتال',
    collateralKind: 'promissory',
    confidence: 'high',
    lastUpdated: '2026-09-19',
    autoDiscovered: true,
    source: {
      title: 'پرتال رسمی بانک خاورمیانه',
      url: 'https://middleeastbank.ir/loans/elites',
      kind: 'direct',
      checked: '2026-09-19',
    },
  };

  // ۱) ادغام در پایگاه داده
  const { merged, stats } = mergeProducts(existingProducts, [newlyIntroducedProduct]);
  assert.equal(stats.added, 1, 'محصول جدید باید با موفقیت اضافه شود');
  assert.equal(stats.updated, 0);
  assert.equal(merged.length, 2, 'تعداد کل محصولات افزایش می‌یابد');

  const addedRecord = merged.find((p) => p.id === 'rade-99901');
  assert.ok(addedRecord, 'رکورد جدید در خروجی ادغام حضور دارد');
  assert.equal(addedRecord.bank, 'بانک خاورمیانه');
  assert.equal(addedRecord.stale, false, 'محصول تازه به هیچ وجه نباید stale باشد');

  // ۲) نرمال‌سازی در وضعیت برنامه
  const normalized = normalizeProduct(addedRecord);
  assert.equal(normalized.bank, 'بانک خاورمیانه');
  assert.equal(normalized.contractType, 'non-partnership', 'عقد به درستی استنتاج می‌شود');

  // ۳) امتیازدهی ۵بعدی و رتبه‌بندی
  const scored = scoreProduct(normalized, {
    benefit: 35, speed: 20, digital: 15, friction: 15, fresh: 15,
  }, { inflation: 51.9 });

  assert.ok(scored.score > 0 && scored.score <= 100, 'امتیاز نهایی باید در بازه ۰ تا ۱۰۰ باشد');
  assert.ok(scored.realRate < 0, 'بازده حقیقی وام با نرخ ۱۸٪ و تورم ۵۱.۹٪ باید منفی باشد');
  assert.equal(scored.parts.benefit > 0, true, 'امتیاز بعد مزیت محاسبه می‌شود');

  // ۴) در دسترس بودن بانک جدید در فیلترها به صورت پویا
  const bankSet = new Set(merged.map((p) => p.bank));
  assert.ok(bankSet.has('بانک خاورمیانه'), 'بانک جدید به طور پویا در فیلترها افزوده می‌شود');
});


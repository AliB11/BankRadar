/**
 * آزمون‌های نوع عقد (تفکیک منطقی تسهیلات) و اصلاحات محاسباتی/منطقی:
 *
 *   ۱. استنتاج محتاطانه نوع عقد از رکورد (deriveContractType) — قواعد و ترتیب آن‌ها
 *   ۲. فیلتر «نوع عقد» — اعمال در دسته‌های اعتباری، خنثی در سایر دسته‌ها
 *   ۳. نمایش فیلتر در پنل، نشان عقد روی کارت و ردیف نوع عقد در کشو
 *   ۴. «کنترل‌شده بودن» رکورد = جدیدترین تاریخ بازبینی/منبع (فیلتر onlyFresh
 *      و مرتب‌سازی «تازه‌ترین کنترل»)
 *   ۵. پیوستگی امتیاز تازگی در مرز بازه‌ها (افت پله‌ای نباشد)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --- شبیه‌سازی حداقلی محیط مرورگر (همان‌طور که render.test.mjs انجام می‌دهد) --- */

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.location = { reload: () => {} };

const bundleSource = fs.readFileSync(path.join(ROOT, 'data/bundle.js'), 'utf8');
const sandbox = {};
new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;

const store = await import('../assets/js/store.js');
const views = await import('../assets/js/views.js');
const {
  store: S, loadData, filtered, contractCounts, deriveContractType,
  CONTRACT_META, CONTRACT_KEYS, isCreditCategory,
} = store;

await loadData();

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/* ---------- ۱) استنتاج نوع عقد ---------- */

test('کارمزد به‌تنهایی نوع عقد را ثابت نمی‌کند', () => {
  assert.equal(deriveContractType({ category: 'loans', subcategory: 'marriage', rateKind: 'fee', rate: 4 }), 'qarz');
  assert.equal(deriveContractType({ category: 'credit', rateKind: 'fee', rate: 4 }), 'unknown');
  assert.equal(deriveContractType({ rateKind: 'fee', rate: 4, desc: 'بر پایه عقد مشارکت' }), 'partnership');
});

test('ذکر صریح قرض‌الحسنه با نرخ پایین، قرض‌الحسنه است', () => {
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 4, product: 'تسهیلات قرض‌الحسنه ایثارگران' }),
    'qarz',
  );
  // «قرض الحسنه» با فاصله هم خوانده شود
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 5, product: 'وام قرض الحسنه ازدواج' }),
    'qarz',
  );
  // ذکر قرض‌الحسنه با نرخ ۱۵٪ فقط ارجاع به قرارداد دیگر است، نه نوع عقد خود محصول
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 15, desc: 'در مقابل قرض‌الحسنه ۴ درصدی…' }),
    'unknown',
  );
});

test('ذکر صریح مشارکت/مضاربه در تسهیلات سودمحور، مشارکتی است', () => {
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 23, desc: 'تسهیلات بر پایه عقد مشارکت مدنی' }),
    'partnership',
  );
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 22, desc: 'عقد مضاربه منسوب' }),
    'partnership',
  );
});

test('نرخ سود به‌تنهایی نوع عقد را مشخص نمی‌کند', () => {
  assert.equal(deriveContractType({ rateKind: 'profit', rate: 23, product: 'وام خودروسازی' }), 'unknown');
  assert.equal(deriveContractType({ rateKind: 'profit', rate: 23, product: 'وام مرابحه' }), 'non-partnership');
  assert.equal(deriveContractType({ rateKind: 'profit', rate: 8, tags: ['وام نقدی'] }), 'unknown');
  // نشانه عقد از loanType افزونه (خریدار خودکار) هم خوانده می‌شود — اما فقط
  // وقتی با نرخ هم‌خوان است؛ برچسبِ «قرض‌الحسنه» با نرخ ۲۳٪ تناقض دارد و
  // نرخ، که مبناي موتور مالی است، بر برچسب برتری دارد.
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 4, extra: { loanType: 'وام قرض الحسنه' } }),
    'qarz',
  );
  assert.equal(
    deriveContractType({ rateKind: 'profit', rate: 23, extra: { loanType: 'وام قرض الحسنه' } }),
    'unknown',
  );
});

test('بدون نرخ، ادعایی شکل نمی‌گیرد', () => {
  assert.equal(deriveContractType({ rateKind: 'none', rate: 0, product: 'باشگاه مشتریان' }), 'unknown');
  assert.equal(deriveContractType({ rate: 0, rateKind: 'profit' }), 'unknown');
  assert.equal(deriveContractType(null), 'unknown');
});

test('هر محصول بارگذاری‌شده نوع عقد معتبر دارد', () => {
  for (const p of S.products) {
    assert.ok(CONTRACT_META[p.contractType], `نوع عقد نامعتبر برای ${p.id}: ${p.contractType}`);
  }
  // در دادهٔ فعلی، قرض‌الحسنه‌های تسهیلات همهٔ محصولات کارمزد‌محورِ تسهیلاتی هستند
  const qarzLoans = S.products.filter((p) => p.category === 'loans' && p.contractType === 'qarz');
  assert.ok(qarzLoans.length > 20, 'باید قرض‌الحسنهٔ قابل‌توجهی در دسته تسهیلات باشد');
  assert.ok(qarzLoans.every((p) => p.rateKind === 'fee' || p.rate <= 10), 'همهٔ قرض‌الحسنه‌ها کارمزد‌محور یا کم‌نرخ‌اند');
});

/* ---------- ۲) فیلتر نوع عقد ---------- */

test('فیلتر نوع عقد در دسته تسهیلات، تفکیک منطقی می‌دهد', () => {
  const previous = { ...S.filters };
  S.filters.category = 'loans';
  S.filters.contract = 'all';
  const total = filtered().length;

  let sum = 0;
  for (const key of CONTRACT_KEYS) {
    S.filters.contract = key;
    const rows = filtered();
    sum += rows.length;
    assert.ok(rows.every((p) => p.contractType === key), `هر ردیف «${key}» باید هم‌نوع باشد`);
  }
  S.filters.contract = 'all';
  assert.equal(sum, total, 'مجموع زیرمجموعه‌ها باید کل دسته را بپوشاند');
  assert.ok(total > 50, 'دسته تسهیلات باید رکورد کافی برای پالایش داشته باشد');

  Object.assign(S.filters, previous);
});

test('فیلتر نوع عقد برای دسته‌های غیراعتباری خنثی است', () => {
  const previous = { ...S.filters };
  S.filters.category = 'deposits';
  S.filters.contract = 'qarz';
  const deposits = filtered().length;
  S.filters.contract = 'all';
  assert.equal(deposits, filtered().length, 'انتخاب نوع عقد نباید نتایج سپرده‌ها را خالی کند');
  Object.assign(S.filters, previous);
});

test('شمارندهٔ گزینه‌های نوع عقد با داده هم‌خوان است', () => {
  const counts = contractCounts('loans');
  const loans = S.products.filter((p) => p.category === 'loans');
  assert.equal(counts.all, loans.length);
  for (const key of CONTRACT_KEYS) {
    assert.equal(counts[key], loans.filter((p) => p.contractType === key).length, `شمار «${key}»`);
  }
});

test('فیلتر نوع عقد فقط در دسته‌های اعتباری رندر می‌شود', () => {
  const previous = { ...S.filters };

  S.filters.category = 'loans';
  assert.ok(views.filtersHTML().includes('data-filter="contract"'), 'تسهیلات باید فیلتر نوع عقد داشته باشد');

  S.filters.category = 'credit';
  assert.ok(views.filtersHTML().includes('data-filter="contract"'), 'اعتباری باید فیلتر نوع عقد داشته باشد');

  S.filters.category = 'deposits';
  assert.ok(!views.filtersHTML().includes('data-filter="contract"'), 'منابعی فیلتر نوع عقد نمی‌خواهد');

  Object.assign(S.filters, previous);
});

test('کارت‌های اعتباری نشان نوع عقد دارند و سپرده‌ها نه', () => {
  const loan = S.products.find((p) => p.category === 'loans');
  const deposit = S.products.find((p) => p.category === 'deposits');
  assert.ok(views.cardHTML(loan).includes(CONTRACT_META[loan.contractType].short), 'کارت تسهیلاتی باید نشان عقد داشته باشد');
  assert.ok(!views.cardHTML(deposit).includes('نوع عقد'));
});

test('کشوی جزئیات برای محصولات اعتباری، نوع عقد را اعلام می‌کند', () => {
  const loan = S.products.find((p) => p.category === 'loans' && p.maxAmount);
  const html = views.detailHTML(loan);
  assert.ok(html.includes('نوع عقد'), 'کشو باید ردیف نوع عقد داشته باشد');
  assert.ok(html.includes(CONTRACT_META[loan.contractType].label), 'برچسب کامل نوع عقد باید دیده شود');
});

test('خروجی CSV ستون نوع عقد را دارد', async () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
  assert.match(appSrc, /'contractType'/, 'CSV_COLUMNS باید contractType را داشته باشد');
});

test('مقدار صریح contractType داده، بر استنتاج ارجحیت دارد', async () => {
  // normalizeProduct از مسیر loadData می‌آید. یک بستهٔ موقت با دو رکورد
  // تزریق می‌کنیم: یکی نوع عقد صریح معتبر دارد (باید پاس شود) و دیگری مقدار
  // نامعتبر (باید بی‌صدا به استنتاج سپرده شود، نه مقدار خام).
  const originalBundle = globalThis.__BANK_RADAR__;
  const base = originalBundle.products[0];
  const tempBundle = {
    ...originalBundle,
    products: [
      { ...base, id: 'explicit-ok', rate: 23, rateKind: 'profit', contractType: 'partnership', desc: '' },
      { ...base, id: 'explicit-bad', rate: 23, rateKind: 'profit', contractType: 'bogus', desc: '' },
      { ...base, id: 'derived', rate: 23, rateKind: 'profit' },
    ],
  };

  try {
    globalThis.__BANK_RADAR__ = tempBundle;
    const ok = await loadData();
    assert.equal(ok, true);

    const byId = Object.fromEntries(S.products.map((p) => [p.id, p]));
    assert.equal(byId['explicit-ok'].contractType, 'partnership', 'مقدار صریح معتبر باید پاس شود');
    assert.equal(byId['explicit-bad'].contractType, 'unknown', 'مقدار نامعتبر باید به استنتاج سپرده شود');
    assert.equal(byId['derived'].contractType, 'unknown', 'در نبود مقدار صریح، استنتاج می‌شود');
  } finally {
    globalThis.__BANK_RADAR__ = originalBundle;
    await loadData(); // بازگرداندن محصولات به وضعیت اصلی
  }
});

/* ---------- ۳) «کنترل‌شده بودن» = جدیدترین تاریخ بازبینی/منبع ---------- */

test('فیلتر onlyFresh بر پایه تاریخ کنترل (بازبینی یا منبع) اعمال می‌شود', () => {
  const backup = [...S.products];
  try {
    S.products = [
      { ...backup[0], id: 'f1', category: 'loans', lastUpdated: '2025-12-01', lastSeen: iso(1) },
      { ...backup[0], id: 'f2', category: 'loans', lastUpdated: '2025-12-01', lastSeen: '2025-12-01' },
      { ...backup[0], id: 'f3', category: 'loans', lastUpdated: iso(30), lastSeen: null },
    ];
    S.filters.category = 'loans';
    S.filters.onlyFresh = true;

    const rows = filtered();
    const ids = rows.map((p) => p.id).sort();
    // f1 دیروز کنترل شده (منبعش ۹ ماهه است ولی خط لوله دیده) → می‌ماند
    // f2 هر دو تاریخش کهنه است → حذف می‌شود
    // f3 فقط منبع تازه دارد → می‌ماند
    assert.deepEqual(ids, ['f1', 'f3'], 'ملاک، جدیدترین تاریخ بازبینی یا منبع است');
  } finally {
    S.products = backup;
    S.filters.onlyFresh = false;
  }
});

test('مرتب‌سازی «تازه‌ترین کنترل» هم بر پایه تاریخ کنترل است', () => {
  const backup = [...S.products];
  try {
    S.products = [
      { ...backup[0], id: 's1', category: 'loans', lastUpdated: '2026-01-01', lastSeen: iso(2) },
      { ...backup[0], id: 's2', category: 'loans', lastUpdated: iso(10), lastSeen: iso(10) },
    ];
    S.filters.category = 'loans';
    S.filters.sort = 'fresh';
    const rows = filtered();
    assert.equal(rows[0].id, 's1', 'رکورد تازه‌ترِ کنترل‌شده باید اول بایستد');
  } finally {
    S.products = backup;
    S.filters.sort = 'score';
  }
});

test('فیلترهای ذخیره‌شده با نوع عقد نامعتبر، بازنشانی می‌شوند', async () => {
  // شبیه‌سازی دادهٔ کهنهٔ localStorage از نسخهٔ پیشین سامانه
  memory.set('bankradar.v2.filters', JSON.stringify({ category: 'loans', contract: 'bogus' }));
  const ok = await loadData();
  assert.equal(ok, true);
  assert.equal(S.filters.contract, 'all', 'نوع عقد نامعتبر باید به «همه» بازگردد');
  assert.equal(S.filters.category, 'loans', 'دستهٔ معتبر نباید دست بخورد');
  memory.delete('bankradar.v2.filters');
});

/* ---------- ۴) پیوستگی امتیاز تازگی ---------- */

test('امتیاز تازگی در مرز بازه‌ها جهش پله‌ای ندارد', async () => {
  const { freshnessScore } = await import('../assets/js/score.js');
  // در مرز ۷ روز، پلاتو به شیب ۲۸/۲۳ می‌رسد (افت ≈۱٫۲)؛ مرزهای بعدی باید
  // عملاً پیوسته باشند. نگرانی اصلی جهش‌های پله‌ای بزرگ است (پیش از اصلاح،
  // مرز ۷ افت ۱۰٫۸ و مرز ۱۸۰ افت ۴٫۰۵ نمره داشت).
  for (const boundary of [7, 30, 90, 180, 365]) {
    const before = freshnessScore(iso(boundary));
    const after = freshnessScore(iso(boundary + 1));
    assert.ok(
      Math.abs(before - after) <= 1.5,
      `افت امتیاز در مرز ${boundary} بیش از حد مجاز است: ${before} → ${after}`,
    );
  }
  // و همچنان نزولی است
  assert.ok(freshnessScore(iso(10)) > freshnessScore(iso(100)), 'تازگی نزولی است');
  // رکورد یک‌ساله زیر ۲۰ نمره می‌ماند (انتظار render.test.mjs)
  assert.ok(freshnessScore(iso(365)) < 20, 'رکورد یک‌ساله‌ای باید کم‌امتیاز باشد');
});

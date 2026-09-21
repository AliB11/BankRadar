/**
 * آزمون لایه نمایش: اطمینان از اینکه تولید HTML بدون خطای زمان اجرا انجام
 * می‌شود و مقادیر داده هرگز به‌صورت خام درج نمی‌شوند.
 *
 * چون مرورگر در دسترس نیست، حداقلِ محیط DOM شبیه‌سازی می‌شود. این آزمون
 * خطاهای ارجاعی و شکست قالب‌ها را پیش از انتشار می‌گیرد.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --- شبیه‌سازی حداقلی محیط مرورگر --- */

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.location = { reload: () => {} };

// داده درون‌خطی همان‌طور که bundle.js تولید می‌کند
const bundleSource = fs.readFileSync(path.join(ROOT, 'data/bundle.js'), 'utf8');
const sandbox = {};
new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;

const store = await import('../assets/js/store.js');
const views = await import('../assets/js/views.js');
const finance = await import('../assets/js/finance.js');

/* --- آزمون‌ها --- */

test('داده از بسته درون‌خطی بارگذاری می‌شود', async () => {
  const ok = await store.loadData();
  assert.equal(ok, true, 'بارگذاری باید موفق باشد');
  assert.ok(store.store.products.length > 40, 'باید بیش از ۴۰ محصول بارگذاری شود');
  assert.ok(store.store.indicators.inflationAnnual, 'شاخص تورم باید موجود باشد');
});

test('همه محصولات امتیاز عددی معتبر می‌گیرند', () => {
  for (const p of store.store.products) {
    const score = store.scoreOf(p.id);
    assert.ok(Number.isFinite(score), `امتیاز ${p.id} عدد نیست`);
    assert.ok(score >= 0 && score <= 100, `امتیاز ${p.id} خارج از بازه است: ${score}`);
  }
});

test('قالب بخش قهرمان بدون خطا ساخته می‌شود', () => {
  const out = views.heroHTML();
  assert.ok(out.includes('رادار محصولات بانکی ایران'));
  assert.ok(out.includes('macro-cell'), 'نوار شاخص‌های کلان باید رندر شود');
});

test('قالب فیلترها و برگه‌های دسته‌بندی ساخته می‌شود', () => {
  const filters = views.filtersHTML();
  assert.ok(filters.includes('data-filter="bank"'));
  assert.ok(filters.includes('data-weight="benefit"'));
  const tabs = views.tabsHTML();
  for (const cat of ['deposits', 'funds', 'credit', 'loans', 'loyalty']) {
    assert.ok(tabs.includes(`data-key="${cat}"`), `دسته ${cat} باید در برگه‌ها باشد`);
  }
});

test('فیلترهای ذخیره‌شده پس از بازخوانی صفحه انتخاب‌شده می‌مانند', () => {
  // مقدار minScore در وضعیت «عدد» نگه داشته می‌شود ولی مقدار option رشته است؛
  // اگر مقایسه دقیق باشد، فیلتر اعمال است ولی فهرست «نمایش همه» را نشان می‌دهد.
  const previous = { ...store.store.filters };
  const bank = store.availableBanksIn(previous.category)[0];

  store.store.filters.minScore = 65;
  store.store.filters.bank = bank;

  const html = views.filtersHTML();
  assert.match(html, /<option value="65" selected>/, 'حداقل امتیاز ذخیره‌شده باید انتخاب‌شده بماند');
  assert.ok(
    html.includes(`<option value="${bank}" selected>`),
    `بانک «${bank}» باید انتخاب‌شده علامت بخورد`,
  );

  Object.assign(store.store.filters, previous);
});

test('کارت محصول برای همه رکوردها بدون خطا ساخته می‌شود', () => {
  for (const category of ['deposits', 'funds', 'credit', 'loans', 'loyalty']) {
    store.store.filters.category = category;
    const rows = store.filtered();
    assert.ok(rows.length > 0, `دسته ${category} باید محصول داشته باشد`);
    const html = views.cardsHTML(rows);
    assert.ok(html.includes('class="card'), `دسته ${category} باید کارت تولید کند`);
    assert.ok(!html.includes('undefined'), `دسته ${category} نباید undefined در خروجی داشته باشد`);
  }
});

test('جدول مقایسه با انتخاب چند محصول ساخته می‌شود', () => {
  const ids = store.store.products.slice(0, 3).map((p) => p.id);
  store.store.compare = new Set(ids);
  const html = views.compareHTML();
  assert.ok(html.includes('جدول مقایسه'));
  assert.ok(html.includes('class="compare"'));
  assert.ok(html.includes('قسط تقریبی'), 'ردیف محاسبه قسط باید موجود باشد');
  store.store.compare.clear();
});

test('نمودارها و رتبه‌بندی رندر می‌شوند', () => {
  store.store.filters.category = 'loans';
  const rows = store.filtered();
  const charts = views.chartsHTML(rows);
  assert.ok(charts.includes('نردبان نرخ سود'));
  assert.ok(charts.includes('<svg'));
  const rank = views.rankHTML(rows);
  assert.ok(rank.includes('رتبه‌بندی جذابیت'));
});

test('کشوی جزئیات شامل ماشین‌حساب و تفکیک امتیاز است', () => {
  const loan = store.store.products.find((p) => p.category === 'loans' && p.maxAmount);
  assert.ok(loan, 'باید حداقل یک وام با سقف مشخص وجود داشته باشد');
  const html = views.detailHTML(loan);
  assert.ok(html.includes('data-calc'), 'ماشین‌حساب باید رندر شود');
  assert.ok(html.includes('چرا این امتیاز؟'));
  assert.ok(html.includes('تفکیک امتیاز'));
});

test('خروجی به‌روزرسانی‌های مرکز داده و روش ساخته می‌شود', () => {
  assert.ok(views.dataModalHTML().includes('مرکز داده'));
  assert.ok(views.methodModalHTML().includes('روش امتیازدهی'));
  assert.ok(views.footerHTML().includes('درباره سامانه'));
});

/* --- آزمون‌های امنیتی و صحت --- */

test('کاراکترهای خاص HTML فرار داده می‌شوند (جلوگیری از تزریق)', () => {
  const hostile = {
    ...store.store.products[0],
    id: 'xss-test',
    bank: '<script>alert("xss")</script>',
    product: '<img src=x onerror=alert(1)>',
    desc: '"><script>steal()</script>',
    tags: ['<b>tag</b>'],
    source: { title: '<script>', url: 'javascript:alert(1)' },
  };
  store.store.scored.set('xss-test', { score: 50, parts: {}, realRate: null, adjustment: 0 });

  const card = views.cardHTML(hostile);
  assert.ok(card.includes('&lt;script&gt;'), 'متن باید فرار داده شود');
  assert.ok(card.includes('&lt;img'), 'تگ تصویر باید فرار داده شود');

  // هیچ تگ یا صفت رویدادی جدیدی از داده ساخته نمی‌شود
  assertNoInjectedTags(card, 'کارت محصول');

  const detail = views.detailHTML(hostile);
  assertNoInjectedTags(detail, 'کشو جزئیات');
  assert.ok(!detail.includes('javascript:alert'), 'نشانی خطرناک نباید فعال درج شود');
});

/**
 * تگ‌های مجاز — همان‌هایی که قالب‌های داخلی سامانه تولید می‌کنند.
 * هر تگ دیگری در خروجی به معنای نفوذ داده به ساختار HTML است.
 * تگ‌های سند/اسکریپت (script, style, meta, …) عمداً در این فهرست نیستند:
 * لایه نمایش فقط قطعه HTML تولید می‌کند و هرگز نباید آن‌ها را بسازد.
 */
const ALLOWED_TAGS = new Set([
  'header', 'footer', 'main', 'aside', 'nav', 'section', 'article', 'div', 'span', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'button', 'label', 'input', 'select', 'option', 'textarea', 'code', 'b', 'strong', 'i', 'em', 'br', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'svg', 'circle', 'path', 'rect', 'g', 'text', 'line', 'polyline', 'defs', 'filter', 'feturbulence',
]);

function assertNoInjectedTags(markup, label) {
  // ۱) هیچ تگ ناشناخته‌ای وجود نداشته باشد
  for (const m of markup.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    const tag = m[1].toLowerCase();
    assert.ok(ALLOWED_TAGS.has(tag), `${label}: تگ ناشناخته «${tag}» در خروجی — احتمال نفوذ داده`);
  }
  // ۲) هیچ صفت رویدادی (on*) داخل هیچ تگی نباشد
  for (const m of markup.matchAll(/<[^>]*>/g)) {
    const attrs = m[0].match(/\son[a-z]+\s*=/gi);
    assert.ok(!attrs, `${label}: صفت رویدادی «${attrs?.[0]?.trim()}» در تگ یافت شد`);
  }
}

test('هیچ رویداد درون‌خطی (onclick) در قالب‌ها وجود ندارد', () => {
  store.store.filters.category = 'loans';
  const combined = [
    views.heroHTML(),
    views.filtersHTML(),
    views.tabsHTML(),
    views.toolbarHTML(store.filtered()),
    views.cardsHTML(store.filtered()),
    views.rankHTML(store.filtered()),
    views.compareHTML(),
    views.chartsHTML(store.filtered()),
    views.dataModalHTML(),
    views.methodModalHTML(),
    views.footerHTML(),
  ].join('');

  assert.ok(!/\son[a-z]+\s*=/i.test(combined), 'نباید هیچ onclick/onerror درون‌خطی وجود داشته باشد');
});

test('محاسبات مالی با مقادیر مرجع شناخته‌شده هم‌خوان است', () => {
  // ۱۰۰ میلیون تومان، نرخ ۱۸٪، ۴۸ ماه
  // قسط دقیق = ۱٬۵۰۰٬۰۰۰ ÷ ۰٫۵۱۰۶۳۸۴ = ۲٬۹۳۷٬۵۰۰ (با شبیه‌سازی جدول استهلاک صحت‌سنجی شد:
  // مانده در پایان دوره صفر می‌شود). برخی گزارش‌های رسانه‌ای عدد ۲٬۹۳۸٬۸۶۳ را ذکر می‌کنند
  // که با محاسبه دقیق هم‌خوان نیست؛ مرجع این پروژه محاسبه ریاضی است نه نقل رسانه.
  const std = finance.scheduleStandard(100_000_000, 18, 48);
  assert.equal(std.installment, 2_937_500);

  // روش قدیمی (سود مازاد): سود = ۱۰۰م × ۱۸ × ۴۹ ÷ ۲۴۰۰ = ۳۶٬۷۵۰٬۰۰۰
  const leg = finance.scheduleLegacy(100_000_000, 18, 48);
  assert.equal(leg.installment, 2_848_958);
  assert.equal(leg.totalInterest, 36_750_000);
});

test('جمع اقساط با جدول استهلاک دقیقاً تسویه می‌شود', () => {
  // صحت‌سنجی مستقل: با قسط محاسبه‌شده، مانده وام باید به صفر برسد
  const P = 250_000_000;
  const rate = 23;
  const months = 60;
  const { installment } = finance.scheduleStandard(P, rate, months);

  let balance = P;
  const r = rate / 100 / 12;
  for (let i = 0; i < months; i++) {
    balance = balance + balance * r - installment;
  }
  assert.ok(Math.abs(balance) < 1000, `مانده نهایی باید نزدیک صفر باشد، دریافت شد ${Math.round(balance)}`);
});

test('نرخ مؤثر از نرخ اسمی بالاتر است', () => {
  // فراخوانی با امضای درست (محصول، مبلغ، ماه، کارمزد کسرشده). پیش‌تر این آزمون
  // با امضای قدیمی (مبلغ، نرخ، ماه، کارمزد) صدا زده می‌شد و چون عدد بزرگ
  // «مبلغ» در جای product می‌نشست، نتیجه تصادفی (۳۵٪) را «تأیید» می‌کرد —
  // درست همان عددی که مستندات مالی هشدار می‌دهد گمراه‌کننده است.
  const eff = finance.effectiveAnnualRate({ rate: 23, rateKind: 'profit' }, 100_000_000, 36, 4);
  assert.ok(eff > 23, `نرخ مؤثر باید بیشتر از ۲۳ باشد، دریافت شد ${eff}`);
  assert.ok(eff < 30, `نرخ مؤثر یک تسهیلات ۲۳٪ با ۴٪ کارمزد باید معقول (زیر ۳۰) باشد، دریافت شد ${eff}`);
});

test('بازده حقیقی برای نرخ ۲۳٪ و تورم ۷۰٪ منفی است', () => {
  const real = finance.realRate(23, 69.9);
  assert.ok(real < -20, `بازده حقیقی باید منفی باشد، دریافت شد ${real}`);
});

test('نشانی‌های خطرناک در href مسدود می‌شوند', async () => {
  const { safeUrl } = await import('../assets/js/util.js');

  assert.equal(safeUrl('javascript:alert(1)'), '', 'طرح javascript مسدود شود');
  assert.equal(safeUrl('JavaScript:alert(1)'), '', 'بی‌توجه به بزرگی/کوچکی حروف');
  assert.equal(safeUrl('  javascript:alert(1)  '), '', 'فاصله ابتدایی نباید فیلتر را دور بزند');
  assert.equal(safeUrl('java\tscript:alert(1)'), '', 'کاراکتر کنترلی نباید فیلتر را دور بزند');
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), '', 'طرح data مسدود شود');
  assert.equal(safeUrl('vbscript:msgbox'), '', 'طرح vbscript مسدود شود');
  assert.equal(safeUrl('//evil.example.com'), '', 'نشانی پروتکل‌نسبی مسدود شود');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');

  assert.equal(safeUrl('https://cbi.ir'), 'https://cbi.ir');
  assert.equal(safeUrl('http://example.com/a?b=1&c=2'), 'http://example.com/a?b=1&amp;c=2');
  assert.equal(safeUrl('mailto:a@b.ir'), 'mailto:a@b.ir');
});

/* ---------- تفکیک «بازبینی» از «به‌روزرسانی منبع» ----------
 *
 * رکوردی که امروز واکشی شده، بازبینی‌شده است حتی اگر صفحه منبع ماه‌ها
 * دست‌نخورده مانده باشد. اگر این دو تاریخ یکی گرفته شوند، صدها رکورد تازه
 * واکشی‌شده کهنه به نظر می‌رسند و امتیاز تازگی و سلامت داده بی‌معنا می‌شود.
 */

test('تازگی بر پایه جدیدترین تاریخ بازبینی و منبع سنجیده می‌شود', async () => {
  const { freshnessScore } = await import('../assets/js/score.js');

  const today = new Date().toISOString().slice(0, 10);
  const old = '2025-01-01';

  // منبع کهنه ولی امروز بازبینی شده → تازه
  const reviewed = freshnessScore({ lastUpdated: old, lastSeen: today });
  assert.equal(reviewed, 100, 'رکورد امروز بازبینی‌شده باید تازه باشد');

  // منبع تازه ولی فقط یک تاریخ → همان تاریخ ملاک است
  const sourceOnly = freshnessScore({ lastUpdated: today });
  assert.equal(sourceOnly, 100);

  // هر دو کهنه → کهنه
  const bothOld = freshnessScore({ lastUpdated: old, lastSeen: old });
  assert.ok(bothOld < 20, `رکورد کهنه باید امتیاز کمی بگیرد، دریافت شد ${bothOld}`);

  // سازگاری با فراخوانی رشته‌ای (پیش از این، ورودی یک تاریخ بود)
  assert.equal(freshnessScore(today), 100);
  assert.equal(freshnessScore(null), 20);
});

test('خلاصه، بازبینی و تازگی منبع را جدا گزارش می‌کند', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const old = '2025-01-01';

  store.store.products = [
    { ...store.store.products[0], id: 't1', lastUpdated: old, lastSeen: today },
    { ...store.store.products[0], id: 't2', lastUpdated: today, lastSeen: today },
    { ...store.store.products[0], id: 't3', lastUpdated: old, lastSeen: old },
  ];
  store.recalculate();

  const s = store.summary();
  assert.equal(s.verified30, 2, 'دو رکورد در ۳۰ روز اخیر بازبینی شده‌اند');
  assert.equal(s.sourceFresh30, 1, 'فقط یک منبع در ۳۰ روز اخیر به‌روز شده است');
  assert.ok(s.health > 0 && s.health <= 100, 'امتیاز سلامت در بازه معتبر باشد');
});

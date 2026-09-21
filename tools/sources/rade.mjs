/**
 * منبع: رده (rade.ir) — مرجع مقایسه وام و خدمات بانکی ایران.
 *
 * مزیت این منبع ساختار ماشین‌خوان است: صفحات وام یک جدول مشخصات با برچسب‌های
 * ثابت دارند («نرخ سود وام»، «سقف وام»، «نوع ضمانت»، …) و فهرست کامل صفحات از
 * loan-sitemap.xml قابل کشف است. بنابراین استخراج بر پایه «برچسب» انجام می‌شود
 * نه سلکتور CSS؛ این روش در برابر تغییر قالب سایت مقاوم است.
 */

import { get, pool, runSource, unwrapPool } from '../lib/http.mjs';
import { foldForMatch, normalizeText, parseRates, parseTomanAmount, stripTags, toNumber } from '../lib/parse.mjs';
import { parseJalaliDate } from '../lib/jalali.mjs';

export const BASE = 'https://www.rade.ir';
const SITEMAP = `${BASE}/loan-sitemap.xml`;

/** نگاشت نوع وام رده به دسته‌بندی سامانه */
const CATEGORY_MAP = {
  'loan-interest-free-loan': { category: 'loans', subcategory: 'qarz', label: 'قرض‌الحسنه' },
  'loan-cash-loan': { category: 'loans', subcategory: 'cash', label: 'وام نقدی' },
  'loan-instant-loan': { category: 'credit', subcategory: 'digital-loan', label: 'وام فوری' },
  'loan-no-guarantor-loans': { category: 'credit', subcategory: 'no-guarantor', label: 'بدون ضامن' },
  'loan-goods-loan': { category: 'credit', subcategory: 'bnpl', label: 'وام کالا' },
  'loan-car-loan': { category: 'loans', subcategory: 'car', label: 'وام خودرو' },
  'loan-home-repair-loans': { category: 'loans', subcategory: 'housing', label: 'تعمیر مسکن' },
  'loan-housing-loans': { category: 'loans', subcategory: 'mortgage', label: 'مسکن' },
};

/** برچسب‌های جدول مشخصات که باید استخراج شوند */
const LABELS = [
  'نرخ سود سپرده پس از وام',
  'هزینه فرصت مسدودی',
  'نسبت مبلغ وام به میزان سپرده',
  'حساب سپرده لازم',
  'مدت زمان مسدودی سپرده',
  'مدت زمان خواب سپرده',
  'نام وام',
  'بانک',
  'نوع وام',
  'نرخ سود وام',
  'مجموع سود وام',
  'کف وام',
  'سقف وام',
  'مبلغ قسط',
  'مجموع وام و سود',
  'حداکثر زمان بازپرداخت',
  'نیاز به سپرده',
  'نیاز به سپرده جداگانه',
  'ثبت‌نام آنلاین',
  'ثبت نام آنلاین',
  'مسدودی سپرده',
  'مدت زمان مسدودی سپرده',
  'مدت زمان خواب سپرده',
  'حداقل مبلغ سپرده',
  'نرخ سود سپرده',
  'نرخ سود سپرده پس از وام',
  'نسبت مبلغ وام به میزان سپرده',
  'حساب سپرده لازم',
  'نوع ضمانت',
  'هزینه‌های جانبی',
  'وضعیت',
  'توضیحات',
];

/** مجموعه برچسب‌های مجاز به شکل تاشده (نیم‌فاصله‌ناوابسته) */
const LABEL_SET = new Set(LABELS.map((l) => foldForMatch(l)));

/**
 * سطرهای جدول HTML را به نگاشت برچسب→مقدار تبدیل می‌کند.
 * @param {string} html
 * @returns {Record<string,string>}
 */
/**
 * خواندن یک ردیف از جدول مشخصات، مستقل از نیم‌فاصله.
 *
 * صفحه‌های رده در جای نیم‌فاصله (U+200C) ناسازگارند؛ «هزینه‌های جانبی» در یک
 * صفحه و «هزینه های جانبی» در صفحه دیگر. اگر برچسب را عیناً جست‌وجو کنیم،
 * بی‌سروصدا داده از دست می‌رود. این تابع هر دو حالت را یکی می‌کند.
 *
 * @param {Record<string,string>} spec خروجی extractSpecTable
 * @param {string} label نام برچسب
 * @param {'value'|'detail'|'raw'} [part]
 */
export function specSel(spec, label, part = 'value') {
  const key = part === 'raw' ? foldForMatch(label) : `${foldForMatch(label)}__${part === 'detail' ? 'detail' : 'value'}`;
  return spec[key] ?? '';
}

export function extractSpecTable(html) {
  const out = {};
  const rows = String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cells || cells.length < 2) continue;

    // کلید با foldForMatch نرمال می‌شود تا تفاوت نیم‌فاصله و فاصله در برچسب
    // (مثلاً «هزینه‌های جانبی» در برابر «هزینه های جانبی») باعث حذف ردیف نشود.
    const label = foldForMatch(stripTags(cells[0]));
    if (!LABEL_SET.has(label)) continue;

    // مقدار اصلی = بخش قبل از <br>، توضیح = بقیه
    const valueHtml = cells.slice(1).join(' ');
    const [valuePart, ...restParts] = valueHtml.split(/<br\s*\/?>/i);
    const value = normalizeText(stripTags(valuePart ?? ''));
    const detail = normalizeText(stripTags(restParts.join(' ')));
    out[label] = detail ? `${value} — ${detail}` : value;
    out[`${label}__value`] = value;
    out[`${label}__detail`] = detail;
  }
  return out;
}

/**
 * استخراج عنوان صفحه از تگ h1
 * @param {string} html
 */
export function extractTitle(html) {
  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return normalizeText(stripTags(h1[1]));
  const og = String(html).match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  return og ? normalizeText(og[1]) : '';
}

/**
 * مرتب‌سازی فاصله در متنی که برای نمایش به کاربر می‌رود.
 * صفحه‌های رده عدد و یکا را بی‌فاصله می‌نویسند («100میلیون تومان»).
 */
export function tidyLabel(text) {
  return normalizeText(String(text ?? ''))
    // ارقام فارسی هم پشتیبانی می‌شوند؛ صفحه‌ها یکدست نیستند
    .replace(/([\d۰-۹])(?=(?:میلیون|میلیارد|هزار|ماه|ماهه|٪|%))/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * تبدیل «نسبت مبلغ وام به میزان سپرده» به عدد درصدی.
 * صفحه‌ها هم «۱۰۰ ٪» و هم «نامشخص» و هم رشته خالی می‌نویسند؛ در حالت نامعلوم
 * باید null برگردد تا با «نسبت نامعلوم» مثل «نسبت مخالف ۱۰۰٪» رفتار نشود.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function parseRatioPercent(text) {
  const t = normalizeText(text);
  if (!t || /نامشخص|متغیر|ندارد|^\s*$/.test(t)) return null;
  const m = t.match(/([\d]+(?:[.,]\d+)?)\s*٪?/);
  if (!m) return null;
  const n = Number(m[1].replace(',', ''));
  return Number.isFinite(n) && n > 0 && n <= 100_000 ? n : null;
}

/** تبدیل مقدار «حداکثر زمان بازپرداخت» به تعداد ماه */
export function parseTermMonths(text) {
  const t = normalizeText(text);
  const months = t.match(/(\d{1,3})\s*ماه/);
  if (months) return Number(months[1]);
  const years = t.match(/(\d{1,2})\s*(?:سال|ساله)/);
  if (years) return Number(years[1]) * 12;
  return null;
}

/**
 * آیا هزینه این محصول «کارمزد یک‌بار» است یا «سود سالانه»؟
 *
 * وام‌های قرض‌الحسنه کارمزد یک‌باری می‌گیرند که روی کل اصل بسته می‌شود؛ وام‌های
 * سودمحور نرخ سالانه دارند. تفکیک این دو برای محاسبه قسط حیاتی است، چون
 * تفسیر نادرست کارمزد ۴٪ به‌عنوان نرخ سالانه، هزینه وام ده‌ساله را حدود ده
 * برابر واقعیت نشان می‌دهد.
 *
 * @param {string} url نشانی صفحه
 * @param {string} title عنوان محصول
 * @param {{category:string}} meta دسته‌بندی
 * @param {number|null} rate نرخ استخراج‌شده
 */
export function isFeeBased(url, title, meta, rate) {
  if (meta.category !== 'loans') return false;
  // نرخ‌های ۲۳٪ و ۲۴٪ سقف مصوب سود هستند، نه کارمزد
  if (rate == null || rate >= 20) return false;

  const text = `${url} ${title}`;

  // ۱) صریح‌ترین نشانه: مسیر یا عنوان قرض‌الحسنه
  if (/قرض‌الحسنه|قرض الحسنه|interest-free-loan/i.test(text)) return true;

  // ۲) وام‌های حمایتی (ازدواج، فرزندآوری، ایثارگران، بازنشستگان) کارمزد ثابت
  //    کم و غیرمرکب دارند و نرخ آن‌ها یک‌بار روی اصل بسته می‌شود
  if (rate <= 10 && /حمایتی|ازدواج|فرزندآوری|ایثارگر|بازنشست/.test(text)) return true;

  // ۳) نرخ‌های بسیار پایین در هر عنوان دیگری هم کارمزد یک‌بار است، چون هیچ
  //    تسهیلات سودمحوری زیر ۶٪ عرضه نمی‌شود
  return rate <= 6;
}

/**
 * حدس دسته‌بندی از مسیر URL
 * @param {string} url
 */
export function categoryFromUrl(url) {
  for (const [slug, meta] of Object.entries(CATEGORY_MAP)) {
    if (url.includes(`/${slug}/`)) return meta;
  }
  return { category: 'loans', subcategory: 'other', label: 'تسهیلات' };
}

/** محاسبه امتیاز «مزیت مالی» بر پایه نرخ و نوع محصول (۰ تا ۱۰۰) */
export function benefitFromRate(rate, category) {
  if (rate == null) return 50;
  // برای تسهیلات و اعتبار: نرخ کمتر = مزیت بیشتر نسبت به سقف ۲۳٪
  if (category === 'loans' || category === 'credit') {
    const capped = Math.min(rate, 30);
    return Math.round(Math.max(5, Math.min(100, 100 - (capped / 23) * 45)));
  }
  // برای سپرده: نرخ بیشتر = مزیت بیشتر نسبت به سقف ۲۳٪
  const capped = Math.min(rate, 30);
  return Math.round(Math.max(5, Math.min(100, (capped / 23) * 60)));
}

/**
 * تبدیل یک صفحه وام رده به رکورد استاندارد سامانه.
 * @param {string} url
 * @param {string} html
 * @returns {object|null}
 */
export function mapToProduct(url, html) {
  const spec = extractSpecTable(html);
  if (!specSel(spec, 'نام وام') && !specSel(spec, 'بانک')) return null;

  const meta = categoryFromUrl(url);
  const title = specSel(spec, 'نام وام') || extractTitle(html);
  const bank = specSel(spec, 'بانک') || 'نامشخص';

  const rateList = parseRates(specSel(spec, 'نرخ سود وام', 'raw'));
  const rate = rateList.length ? rateList[0] : null;

  const maxAmount = parseTomanAmount(specSel(spec, 'سقف وام'));
  const minAmount = parseTomanAmount(specSel(spec, 'کف وام'));
  const installment = parseTomanAmount(specSel(spec, 'مبلغ قسط'));
  const termMonths = parseTermMonths(specSel(spec, 'حداکثر زمان بازپرداخت'));
  const depositRate = parseRates(specSel(spec, 'نرخ سود سپرده', 'raw'));

  const maxDetail = specSel(spec, 'سقف وام', 'detail');
  const guarantee = specSel(spec, 'نوع ضمانت');
  const hasGuarantor = /ضامن/.test(guarantee);
  const needsDeposit = /بله|دارد|الزام/.test(specSel(spec, 'نیاز به سپرده'));

  // ── سقف مشروط ──────────────────────────────────────────────────────────
  // اگر خود صفحه بگوید سقف بر پایه رتبه اعتباری، میانگین حساب یا نسبت سپرده
  // تعیین می‌شود، سقف یک «حق قطعی» نیست و نباید در مقایسه برنده اعلام شود.
  const ratioRaw = specSel(spec, 'نسبت مبلغ وام به میزان سپرده', 'raw');
  const ratioNum = parseRatioPercent(ratioRaw);

  // «نامشخص» یعنی نسبت سپرده نامعلوم است، نه اینکه مخالف ۱۰۰ باشد.
  // پیش‌تر همین اشتباه باعث می‌شد بیشتر رکوردهای خودکار مشروط علامت بخورند.
  const ratioImpliesContingent = ratioNum != null && Math.abs(ratioNum - 100) > 1;

  const ceilingContingent =
    /رتبه\s*اعتباری|میانگین\s*حساب|سابقه\s*حساب|ضوابط|حسب\s*امتیاز/.test(maxDetail) ||
    ratioImpliesContingent ||
    /رتبه\s*اعتباری|حسب\s*امتیاز/.test(specSel(spec, 'توضیحات', 'raw'));

  // ── سقف بی‌معنا: بسته چند‌طرحی ─────────────────────────────────────────
  // صفحه‌هایی مانند «طرح ایرانیار» یک بسته ۹ وامی‌اند و سقف نوشته‌شده
  // (مثلاً ۱۰۰ میلیارد تومان برای کارگزاری‌ها) به هیچ محصول منفردی تعلق
  // ندارد. ثبت آن به‌عنوان سقف یک محصول، جدول مقایسه را بی‌معنا می‌کند.
  const descFull = normalizeText(specSel(spec, 'توضیحات', 'value'));
  const descDetail = normalizeText(specSel(spec, 'توضیحات', 'detail'));
  const planMentions = (descFull + ' ' + descDetail).match(/طرح\s+[\u0600-\u06FF]{3,}/g) ?? [];
  const distinctPlans = new Set(planMentions.map((x) => foldForMatch(x))).size;
  const multiPlan =
    distinctPlans >= 4 ||
    /طرح‌های\s*مختلف|شامل\s*\d+\s*وام|بسته\s*\d+\s*وام/.test(maxDetail + ' ' + descFull);

  const amountIsMeaningful = !multiPlan && maxAmount != null;

  // «آخرین به‌روز رسانی» و «آخرین به روز رسانی» هر دو دیده می‌شوند؛
  // [\s\u200c\u200d]* نیم‌فاصله و نیم‌فاصله مجازی را هم می‌پذیرد.
  const updatedRaw = normalizeText(stripTags(html)).match(
    /آخرین[\s\u200c\u200d]*به[\s\u200c\u200d]*روز[\s\u200c\u200d]*رسانی[\s\u200c\u200d]*:?[\s\u200c\u200d]*([^|]{4,40})/,
  );
  const lastUpdated = parseJalaliDate(updatedRaw?.[1]) || parseJalaliDate(html) || null;

  const slug = url.replace(BASE, '').replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  const numericId = slug.match(/^(\d+)/)?.[1] || slug.slice(0, 24);
  const id = `rade-${numericId}`.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  const checked = new Date().toISOString().slice(0, 10);

  // توضیحات صفحه چند پاراگراف جداشده با <br> است. اگر فقط بخش «detail» را
  // برداریم، متن از میان می‌رود و توضیح ناقص می‌ماند؛ پس هر دو بخش با هم
  // ترکیب می‌شوند.
  const descParts = [specSel(spec, 'توضیحات', 'value'), specSel(spec, 'توضیحات', 'detail')]
    .map(normalizeText)
    .filter(Boolean);

  return {
    id,
    bank,
    product: title,
    category: meta.category,
    subcategory: meta.subcategory,
    rate: rate ?? (depositRate[0] ?? 0),
    // کارمزد در برابر سود سالانه.
    //
    // این تفکیک تعیین می‌کند که موتور مالی عدد rate را سالانه مرکب حساب کند یا
    // کارمزد یک‌بار روی کل اصل. تشخیص بر پایه سه نشانه است، نه فقط عدد نرخ:
    // مسیر قرض‌الحسنه در نشانی، واژه قرض‌الحسنه در عنوان، و نرخ پایین غیرمتعارف.
    rateKind: isFeeBased(url, title, meta, rate) ? 'fee' : 'profit',
    rateLabel: rate != null ? `سود ${rate}٪` : 'نامشخص',
    regulatory: false,
    benefit: benefitFromRate(rate, meta.category),
    minAmount: multiPlan ? null : minAmount,
    maxAmount: amountIsMeaningful ? maxAmount : null,
    amountLabel: tidyLabel(specSel(spec, 'سقف وام')) || 'نامشخص',
    // در بسته چند‌طرحی، مدت بازپرداخت هم بین طرح‌ها متفاوت است
    termMonths: multiPlan ? null : termMonths,
    termLabel: tidyLabel(specSel(spec, 'حداکثر زمان بازپرداخت')) || 'نامشخص',
    ceilingContingent: ceilingContingent || multiPlan,
    multiPlan,
    speed: 60,
    digital: /آنلاین|اپلیکیشن|غیرحضوری/.test(descParts.join(' ')) ? 85 : 60,
    friction: hasGuarantor ? 50 : needsDeposit ? 60 : 72,
    collateral: guarantee || specSel(spec, 'نوع ضمانت', 'detail') || 'نامشخص',
    collateralKind: hasGuarantor ? 'guarantor' : needsDeposit ? 'deposit-block' : 'credit-score',
    audience: 'متقاضیان تسهیلات بانکی',
    desc: (descParts.join(' ') || title).slice(0, 700),
    tags: [meta.label, bank.replace(/^بانک\s*/, '')].filter(Boolean),
    requirements: [
      guarantee && `ضمانت: ${guarantee}`,
      needsDeposit && `نیاز به سپرده: ${specSel(spec, 'حداقل مبلغ سپرده') || 'دارد'}`,
      specSel(spec, 'هزینه‌های جانبی') && `هزینه جانبی: ${specSel(spec, 'هزینه‌های جانبی')}`,
      installment && `قسط تقریبی: ${installment.toLocaleString('en-US')} تومان`,
    ].filter(Boolean),
    // بسته چند‌طرحی نمی‌تواند «ارقام قطعی» داشته باشد
    confidence: multiPlan ? 'low' : 'medium',
    autoDiscovered: true,
    sourceKind: 'aggregator',
    // اگر صفحه تاریخ خوانایی نداشت، تاریخ مشاهده ثبت می‌شود: اعتبارسنجی داده
    // تاریخ را الزامی می‌داند و رکورد بی‌تاریخ، خط لوله را سرخ می‌کند.
    lastUpdated: lastUpdated || checked,
    source: {
      title: `رده — ${title}`,
      url,
      kind: 'aggregator',
      checked,
    },
    extra: {
      loanType: specSel(spec, 'نوع وام') || meta.label,
      ...(multiPlan ? { plans: distinctPlans, note: 'بسته چند‌طرحی؛ سقف و مدت منفرد ندارد' } : {}),
      installment,
      totalWithInterest: parseTomanAmount(specSel(spec, 'مجموع وام و سود')),
      totalInterest: parseTomanAmount(specSel(spec, 'مجموع سود وام')),
    },
  };
}

/**
 * فهرست همه صفحات وام از sitemap.
 * @returns {Promise<Array<{url:string, lastmod:string|null}>>}
 */
export async function fetchLoanIndex() {
  const xml = await get(SITEMAP, { timeout: 30_000, retries: 2 });
  const out = [];
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    if (url === `${BASE}/loan/` || url === `${BASE}/loan`) continue;
    if (!Object.keys(CATEGORY_MAP).some((slug) => url.includes(`/${slug}/`))) continue;
    out.push({ url, lastmod: m[2] ? m[2].slice(0, 10) : null });
  }
  return out;
}

/**
 * انتخاب مجموعه واکشی: تازه‌ترین صفحه‌ها به‌همراه چرخش بازبینی.
 *
 * این تابع عمداً خالص است (هیچ درخواست شبکه‌ای ندارد) تا بتوان تصمیم‌گیری
 * آن را مستقل آزمود. انتخاب اشتباه در اینجا یعنی یا صفحه‌های مهم‌تر
 * واکشی نمی‌شوند، یا رکورد قدیمی هرگز بازبینی نمی‌شود.
 *
 * @param {{url:string,lastmod?:string|null}[]} index
 * @param {{limit?:number, sinceMonths?:number, refreshUrls?:string[], now?:number}} [opts]
 * @returns {{selected:{url:string,lastmod:string|null}[], rotation:{url:string,lastmod:null}[]}}
 */
export function selectFetchSet(index, opts = {}) {
  const { limit = 120, sinceMonths = 18, refreshUrls = [], now = Date.now() } = opts;

  const cutoff = new Date(now - sinceMonths * 30 * 86_400_000).toISOString().slice(0, 10);
  const fresh = index.filter((e) => !e.lastmod || e.lastmod >= cutoff);

  // اگر بریدن زمانی همه چیز را حذف کند، محدودیت نادیده گرفته می‌شود:
  // دادن داده کهنه بهتر از ندادن داده است.
  const pool = fresh.length ? fresh : index;

  const selected = [...pool]
    .sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)) || a.url.localeCompare(b.url))
    .slice(0, limit);

  const chosen = new Set(selected.map((e) => e.url));
  const rotation = [...new Set(refreshUrls)]
    .filter((url) => url && !chosen.has(url) && url.startsWith(BASE))
    .map((url) => ({ url, lastmod: null }));

  return { selected, rotation };
}

/**
 * واکشی مجموعه‌ای از صفحه‌های وام و تبدیل آن‌ها به رکورد.
 *
 * این بخش از collect جدا شده تا مستقل از نقشه سایت (و بدون شبکه واقعی) قابل
 * آزمون باشد: آزمون می‌تواند فهرست دلخواهی از نشانی‌ها را با سرور محلی بسنجد.
 *
 * @param {Array<{url:string, lastmod?:string|null}>} work
 * @param {{concurrency?:number, log?:Function}} [opts]
 * @returns {Promise<{products:object[], failures:Array<{url:string,error:string}>}>}
 */
export async function collectPages(work, opts = {}) {
  const { concurrency = 5 } = opts;

  const tasks = work.map((entry) => async () => {
    const result = await runSource(`rade:${entry.url}`, async () => {
      const html = await get(entry.url, { timeout: 25_000, retries: 1 });
      return mapToProduct(entry.url, html);
    });
    return { entry, ...result };
  });

  // pool نتیجه هر کار را در پاکت {ok,data} می‌پیچد. اگر پاکت باز نشود، آنچه
  // «محصول» خوانده می‌شود در واقع پوسته‌ای از نتیجه است (بدون فیلد product) و
  // mergeProducts آن را بی‌صدا دور می‌اندازد؛ یعنی خط لوله «موفق» گزارش می‌کند
  // ولی هیچ داده‌ای به‌روز نمی‌شود. unwrapPool پاکت را باز می‌کند و در شکستِ
  // سطح pool، نشانی را از روی اندیس بازمی‌گرداند.
  const results = unwrapPool(await pool(tasks, concurrency), work, 'entry');

  const products = results.filter((r) => r.ok && r.data).map((r) => r.data);
  const failures = results
    .filter((r) => !r.ok)
    .map((f) => ({ url: f.entry?.url ?? 'نامشخص', error: f.error }));

  return { products, failures };
}

/**
 * دریافت و تبدیل صفحات وام.
 *
 * دو نوع صفحه واکشی می‌شود:
 *
 *   ۱. تازه‌ترین‌ها بر پایه lastmod نقشه سایت — چیزهایی که احتمال تغییرشان
 *      بیشتر است.
 *   ۲. چرخش بازبینی — نشانی‌هایی که در اجراهای گذشته دیده شده‌اند و
 *      قدیمی‌ترین lastSeen را دارند. بدون این بخش، رکوردی که یک بار با
 *      تجزیه‌کننده معیوب ثبت شده باشد تا ابد خراب می‌ماند، چون صفحه‌اش
 *      دیگر در فهرست تازه‌ها نیست و هرگز دوباره خوانده نمی‌شود.
 *
 * @param {{limit?:number, concurrency?:number, sinceMonths?:number, refreshUrls?:string[], log?:Function}} [opts]
 */
export async function collect(opts = {}) {
  const { limit = 120, concurrency = 5, sinceMonths = 18, refreshUrls = [], log = () => {} } = opts;
  const index = await fetchLoanIndex();
  log(`رده: ${index.length} صفحه وام در فهرست یافت شد`);

  const { selected, rotation } = selectFetchSet(index, { limit, sinceMonths, refreshUrls });
  log(`رده: ${selected.length} صفحه تازه برای واکشی انتخاب شد`);
  if (rotation.length) log(`رده: ${rotation.length} صفحه قدیمی برای بازبینی چرخشی`);

  const work = [...selected, ...rotation];

  const { products, failures } = await collectPages(work, { concurrency, log });

  return {
    source: 'rade.ir',
    discovered: index.length,
    attempted: work.length,
    fresh: selected.length,
    rotated: rotation.length,
    parsed: products.length,
    failures,
    products,
  };
}

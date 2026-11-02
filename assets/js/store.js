/**
 * وضعیت مرکزی سامانه: بارگذاری داده، فیلترها، مرتب‌سازی و ماندگاری انتخاب‌ها.
 *
 * راهبرد بارگذاری داده:
 *   ۱. data/bundle.js از طریق تگ script بارگذاری می‌شود → روی file:// هم کار می‌کند
 *   ۲. در محیط وب، data/products.json تازه‌تر از بسته بررسی و در صورت تفاوت جایگزین می‌شود
 *   ۳. در نبود هر دو، پیام خطای قابل‌فهم نمایش داده می‌شود (نه صفحه سفید)
 */

import { storage, daysSince, clamp } from './util.js';
import { DEFAULT_WEIGHTS, scoreProduct, PRESETS, mostRecent, freshnessScore } from './score.js';

const CATEGORY_META = {
  deposits: { title: 'منابعی و سپرده', short: 'سپرده', icon: '💰', color: '#2fe0a8', desc: 'سپرده‌ها، گواهی‌ها و طرح‌های سرمایه‌گذاری' },
  funds: { title: 'صندوق‌های درآمد ثابت', short: 'درآمد ثابت', icon: '📈', color: '#00d2ff', desc: 'صندوق‌های ETF و صدور/ابطالی بورسی و بانکی با سود روزشمار' },
  credit: { title: 'اعتباری و کارت', short: 'اعتبار', icon: '💳', color: '#7c8cff', desc: 'کارت اعتباری، خرید اقساطی و وام دیجیتال' },
  loans: { title: 'تسهیلاتی و وام', short: 'تسهیلات', icon: '🏦', color: '#f6c66b', desc: 'وام‌های حمایتی، قرض‌الحسنه و تسهیلات خرد' },
  loyalty: { title: 'امتیازی و باشگاه', short: 'امتیاز', icon: '⭐', color: '#ff8fb0', desc: 'باشگاه مشتریان، پاداش و خدمات دیجیتال' },
};

export { CATEGORY_META };

/**
 * نوع عقد تسهیلات — پایه تفکیک منطقی محصولات اعتباری.
 *
 * در نظام بانکی ایران تسهیلات بر پایه سه خانواده عقد منعقد می‌شود:
 *   • قرض‌الحسنه — کارمزد طبق قرارداد؛ برآورد رایج سالانه بر مانده (rateKind: 'fee').
 *   • عقود مشارکتی — مضاربه، مشارکت مدنی و مانند آن‌ها.
 *   • عقود غیرمشارکتی (مبادله‌ای) — مرابحه، مزارعه، اجاره و مانند آن‌ها.
 *
 * فیلد اختیاری «contractType» در داده، نوع عقد را صریح ثبت می‌کند. در نبود
 * آن، نوع عقد با شواهد ثبت‌شده استنتاج می‌شود و در نبود شاهد نامشخص می‌ماند (deriveContractType)
 * تا رکوردهای تازه‌وارد هم بدون دخالت خط لوله تفکیک‌پذیر بمانند.
 */
export const CONTRACT_META = {
  qarz: { label: 'قرض‌الحسنه', short: 'قرض‌الحسنه', hint: 'کارمزد طبق قرارداد؛ در برآورد مدل سالانه بر مانده فرض می‌شود' },
  'non-partnership': { label: 'عقود غیرمشارکتی (مبادله‌ای)', short: 'غیرمشارکتی', hint: 'مرابحه، مزارعه، اجاره و مانند آن‌ها' },
  partnership: { label: 'عقود مشارکتی', short: 'مشارکتی', hint: 'مضاربه و مشارکت' },
  unknown: { label: 'نامشخص', short: 'نامشخص', hint: 'نوع عقد در داده ثبت نشده است' },
};

export const CONTRACT_KEYS = Object.keys(CONTRACT_META);

/** دسته‌هایی که «نوع عقد» برای آن‌ها معنا دارد (محصولات اعتباری) */
export const isCreditCategory = (category) => category === 'loans' || category === 'credit';

/**
 * استنتاج محتاطانه نوع عقد؛ عدد نرخ به‌تنهایی نوع قرارداد را ثابت نمی‌کند.
 * مقدار صریح contractType پیش از این تابع بررسی می‌شود. بدون شاهد متنی یا
 * دسته مشخص قرض‌الحسنه/ازدواج، نتیجه unknown است.
 */
export function deriveContractType(p) {
  if (!p) return 'unknown';
  const rate = Number(p.rate);
  const text = [p.product, p.desc, ...(Array.isArray(p.tags) ? p.tags : []), p.extra?.loanType, p.source?.url].filter(Boolean).join(' ');
  if (/عقد\s*(?:مشارکت|مضاربه)|مشارکت\s*مدنی|مضاربه/.test(text)) return 'partnership';
  if (/مرابحه|جعاله|مزارعه|اجاره\s*به\s*شرط\s*تملیک/.test(text)) return 'non-partnership';
  if (/قرض[\s\u200c]*الحسنه/.test(text) && (!Number.isFinite(rate) || rate <= 10)) return 'qarz';
  if (p.rateKind === 'fee' && p.category === 'loans' && p.feeModel !== 'unknown' &&
      (p.subcategory === 'qarz' || p.subcategory === 'marriage' || /loan-interest-free-loan|loan-marriage-loan/i.test(text))) return 'qarz';
  return 'unknown';
}

export const store = {
  products: [],
  banks: [],
  indicators: {},
  ranges: {},
  derived: {},
  meta: {},
  period: '',
  weeklyReport: null,
  changelog: null,
  history: [],
  transparency: [],

  filters: {
    query: '',
    bank: 'all',
    minScore: 0,
    channel: 'all',
    collateral: 'all',
    confidence: 'all',
    contract: 'all',
    category: 'deposits',
    sort: 'score',
    onlyFresh: false,
    onlyStale: false,
  },

  weights: { ...DEFAULT_WEIGHTS },
  activePreset: 'balanced',
  compare: new Set(),
  scored: new Map(),
  lastError: null,
};

/* ---------- بارگذاری داده ---------- */

export function normalizeProduct(raw, index) {
  const product = {
    id: raw.id || `product-${index}`,
    bank: raw.bank || 'نامشخص',
    bankId: raw.bankId || null,
    product: raw.product || 'محصول بدون نام',
    category: CATEGORY_META[raw.category] ? raw.category : 'loans',
    subcategory: raw.subcategory || 'other',
    rate: Number(raw.rate) || 0,
    rateKind: raw.rateKind || 'profit',
    rateLabel: raw.rateLabel || '',
    rateKnown: raw.rateKnown ?? (raw.rate != null && !(Number(raw.rate) === 0 && /نامشخص|متغیر/.test(raw.rateLabel || ''))),
    feeModel: raw.feeModel || null,
    paymentSchedule: raw.paymentSchedule || null,
    availability: raw.availability || 'available',
    availabilityNote: raw.availabilityNote || '',
    availabilitySource: raw.availabilitySource || null,
    benefit: numOr(raw.benefit, 55),
    minAmount: raw.minAmount ?? null,
    maxAmount: raw.maxAmount ?? null,
    amountLabel: raw.amountLabel || '',
    termMonths: raw.termMonths ?? null,
    termLabel: raw.termLabel || '',
    speed: numOr(raw.speed, 55),
    digital: numOr(raw.digital, 55),
    friction: numOr(raw.friction, 55),
    collateral: raw.collateral || 'نامشخص',
    collateralKind: raw.collateralKind || 'mixed',
    audience: raw.audience || '',
    desc: raw.desc || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    confidence: raw.confidence || 'medium',
    regulatory: raw.regulatory === true,
    ceilingContingent: raw.ceilingContingent === true,
    multiPlan: raw.multiPlan === true,
    autoDiscovered: raw.autoDiscovered === true,
    stale: raw.stale === true,
    lastUpdated: raw.lastUpdated || null,
    lastSeen: mostRecent(raw.lastSeen, raw.lastVerified, raw.source?.checked) || null,
    lastVerified: raw.lastVerified || null,
    source: raw.source || null,
    extra: raw.extra || {},
  };

  // نوع عقد: مقدار صریح داده اولویت دارد و در نبود آن از خود رکورد استنتاج می‌شود.
  product.contractType = CONTRACT_META[raw.contractType] ? raw.contractType : deriveContractType(product);
  return product;
}

const numOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** داده درون‌خطی bundle.js */
function fromBundle() {
  const b = globalThis.__BANK_RADAR__;
  if (!b || !Array.isArray(b.products)) return null;
  return {
    products: b.products,
    banks: b.banks ?? [],
    indicators: b.indicators ?? {},
    ranges: b.ranges ?? {},
    derived: b.derived ?? {},
    period: b.period ?? '',
    meta: b.meta ?? {},
  };
}

/**
 * تلاش برای دریافت داده تازه‌تر از JSON (فقط در محیط وب).
 * در file:// این فراخوانی شکست می‌خورد و بی‌صدا نادیده گرفته می‌شود.
 */
async function fetchFresh(baseGeneratedAt) {
  try {
    const res = await fetch(`data/products.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.products?.length) return null;
    if (baseGeneratedAt && json.generatedAt && atLeastAsNew(baseGeneratedAt, json.generatedAt)) return null;
    return json;
  } catch {
    return null;
  }
}

/** مقایسه مهرهای زمانی با درنظرگرفتن ناحیه زمانی، نه مقایسه رشته‌ای. */
function atLeastAsNew(candidate, baseline) {
  const next = Date.parse(candidate || '');
  const prev = Date.parse(baseline || '');
  return !Number.isFinite(prev) || (Number.isFinite(next) && next >= prev);
}

async function fetchOptionalJSON(url) {
  try {
    const res = await fetch(`${url}?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function computeTransparencyLocal(products) {
  // با همان وزن‌های گزارش هفتگی، ولی بر پایه مجموعه‌ای که اکنون بارگذاری شده است.
  const byBank = new Map();
  for (const p of products) {
    const key = p.bank || 'نامشخص';
    if (!byBank.has(key)) byBank.set(key, []);
    byBank.get(key).push(p);
  }
  const out = [];
  for (const [bank, list] of byBank) {
    const total = list.length;
    const high = list.filter((x) => x.confidence === 'high').length;
    const stale = list.filter((x) => x.stale).length;
    const avgDigital = list.reduce((a, x) => a + (x.digital ?? 50), 0) / Math.max(1, total);
    const avgFresh = list.reduce((sum, p) => sum + freshnessScore(p), 0) / Math.max(1, total);
    const score = Math.round((avgFresh / 100) * 30 + (high / Math.max(1, total)) * 30 + (avgDigital / 100) * 20 + (1 - stale / Math.max(1, total)) * 20);
    out.push({ bank, bankId: list[0]?.bankId || null, total, highConfidence: high, stale, transparencyScore: score });
  }
  return out.sort((a, b) => b.transparencyScore - a.transparencyScore);
}

/** بازخوانی اجباری آخرین نسخه داده‌ها از مخزن با شکستن حافظه نهان */
export async function reloadFreshData() {
  try {
    const res = await fetch(`data/products.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `پاسخ سرور: ${res.status}` };
    const json = await res.json();
    if (!json?.products?.length) return { ok: false, error: 'داده فاقد محصولات معتبر است.' };

    store.products = json.products.map(normalizeProduct);
    if (json.counts && store.meta) {
      store.meta.counts = json.counts;
    }
    if (json.generatedAt && store.meta) {
      store.meta.generatedAt = json.generatedAt;
      store.meta.loadSource = 'json';
    }

    try {
      const indRes = await fetch(`data/indicators.json?_t=${Date.now()}`, { cache: 'no-store' });
      if (indRes.ok) {
        const indJson = await indRes.json();
        const indMap = indJson?.indicators || indJson;
        if (indMap?.inflationAnnual) {
          store.indicators = indMap;
          store.ranges = indJson.ranges ?? store.ranges;
          store.derived = indJson.derived ?? store.derived;
          store.period = indJson.period ?? store.period;
          store.meta.indicatorsGeneratedAt = indJson.generatedAt ?? store.meta.indicatorsGeneratedAt;
        }
      }
    } catch {
      // استفاده از شاخص‌های موجود
    }

    const [meta, bankFile] = await Promise.all([fetchOptionalJSON('data/meta.json'), fetchOptionalJSON('data/banks.json')]);
    if (meta) store.meta = { ...store.meta, ...meta, loadSource: 'json', generatedAt: json.generatedAt ?? store.meta.generatedAt, counts: json.counts ?? store.meta.counts };
    if (Array.isArray(bankFile?.banks)) {
      store.banks = bankFile.banks;
      store.meta.banksGeneratedAt = bankFile.generatedAt ?? store.meta.banksGeneratedAt;
    }

    // فیدهای هفتگی اختیاری
    const weekly = await fetchOptionalJSON('data/weekly-report.json');
    if (weekly) store.weeklyReport = weekly;
    const changelog = await fetchOptionalJSON('data/changelog.json');
    if (changelog) store.changelog = changelog;
    const history = await fetchOptionalJSON('data/history/weekly-history.json');
    if (Array.isArray(history)) store.history = history;
    store.transparency = computeTransparencyLocal(store.products);

    recalculate();
    return { ok: true, count: store.products.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** بارگذاری کامل داده سامانه */
export async function loadData() {
  const bundled = fromBundle();
  let productsRaw = bundled?.products ?? [];
  let source = bundled ? 'bundle' : 'none';

  const fresh = await fetchFresh(bundled?.meta?.generatedAt);
  if (fresh) {
    productsRaw = fresh.products;
    source = 'json';
  }

  if (!productsRaw.length) {
    store.lastError = 'هیچ داده‌ای بارگذاری نشد. فایل data/bundle.js یا data/products.json در دسترس نیست.';
    return false;
  }

  store.products = productsRaw.map(normalizeProduct);
  store.banks = bundled?.banks ?? [];
  // هر فایل مهر ساخت مستقلی دارد؛ تغییر شاخص یا فهرست بانک نباید به
  // تغییر هم‌زمان products.json یا بازسازی بسته وابسته بماند.
  store.indicators = bundled?.indicators ?? {};
  store.ranges = bundled?.ranges ?? {};
  store.derived = bundled?.derived ?? {};
  store.period = bundled?.period ?? '';
  store.meta = { ...(bundled?.meta ?? {}), loadSource: source };
  if (fresh?.counts) store.meta.counts = fresh.counts;
  if (fresh?.generatedAt) store.meta.generatedAt = fresh.generatedAt;

  const [metaFresh, indicatorsFresh, banksFresh] = await Promise.all([
    fetchOptionalJSON('data/meta.json'), fetchOptionalJSON('data/indicators.json'), fetchOptionalJSON('data/banks.json'),
  ]);
  if (metaFresh && atLeastAsNew(metaFresh.lastRun, store.meta.lastRun)) {
    // تاریخ ساخت و شمار محصولات مربوط به products است، نه آخرین اجرا.
    const { generatedAt, counts } = store.meta;
    store.meta = { ...store.meta, ...metaFresh, generatedAt, counts: counts ?? metaFresh.counts, loadSource: source };
  }
  if (indicatorsFresh?.indicators && atLeastAsNew(indicatorsFresh.generatedAt, store.meta.indicatorsGeneratedAt)) {
    store.indicators = indicatorsFresh.indicators;
    store.ranges = indicatorsFresh.ranges ?? {};
    store.derived = indicatorsFresh.derived ?? {};
    store.period = indicatorsFresh.period ?? '';
    store.meta.indicatorsGeneratedAt = indicatorsFresh.generatedAt ?? store.meta.indicatorsGeneratedAt;
  }
  if (Array.isArray(banksFresh?.banks) && atLeastAsNew(banksFresh.generatedAt, store.meta.banksGeneratedAt)) {
    store.banks = banksFresh.banks;
    store.meta.banksGeneratedAt = banksFresh.generatedAt ?? store.meta.banksGeneratedAt;
  }

  // بازیابی تنظیمات کاربر
  const savedWeights = storage.get('weights');
  if (savedWeights && typeof savedWeights === 'object') {
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      if (typeof savedWeights[k] === 'number') store.weights[k] = savedWeights[k];
    }
  }
  const savedCompare = storage.get('compare');
  if (Array.isArray(savedCompare)) store.compare = new Set(savedCompare);
  const savedFilters = storage.get('filters');
  if (savedFilters && typeof savedFilters === 'object') {
    Object.assign(store.filters, savedFilters);
    if (!CATEGORY_META[store.filters.category]) store.filters.category = 'deposits';
    if (store.filters.contract !== 'all' && !CONTRACT_META[store.filters.contract]) {
      store.filters.contract = 'all';
    }
  }

  recalculate();

  // فیدهای هفتگی اختیاری — در file:// شکست می‌خورد و نادیده گرفته می‌شود
  try {
    const weekly = await fetchOptionalJSON('data/weekly-report.json');
    if (weekly) store.weeklyReport = weekly;
    const changelog = await fetchOptionalJSON('data/changelog.json');
    if (changelog) store.changelog = changelog;
    const history = await fetchOptionalJSON('data/history/weekly-history.json');
    if (Array.isArray(history)) store.history = history;
    store.transparency = computeTransparencyLocal(store.products);
  } catch {
    store.transparency = computeTransparencyLocal(store.products);
  }

  return true;
}

export function saveFilters() {
  storage.set('filters', store.filters);
}

export function saveWeights() {
  storage.set('weights', store.weights);
}

export function saveCompare() {
  storage.set('compare', [...store.compare]);
}

/* ---------- امتیازدهی ---------- */

/** بازمحاسبه امتیاز همه محصولات با وزن‌های جاری */
export function recalculate() {
  const ctx = {
    inflation: store.indicators?.inflationAnnual?.value ?? null,
    interbankRate: store.indicators?.interbankRate?.value ?? null,
  };
  store.scored = new Map();
  for (const p of store.products) {
    store.scored.set(p.id, scoreProduct(p, store.weights, ctx));
  }
}

export const scoreOf = (id) => store.scored.get(id)?.score ?? 0;
export const resultOf = (id) => store.scored.get(id) ?? { score: 0, parts: {}, realRate: null, adjustment: 0 };

/* ---------- فیلتر و مرتب‌سازی ---------- */

export const normalizeSearchText = (s) =>
  String(s ?? '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .toLowerCase()
    .trim();

function searchableText(p) {
  const category = CATEGORY_META[p.category];
  return normalizeSearchText(
    [
      p.bank,
      p.product,
      p.desc,
      p.audience,
      p.collateral,
      p.subcategory,
      p.rate,
      p.rateLabel,
      p.minAmount,
      p.maxAmount,
      p.amountLabel,
      p.termMonths,
      p.termLabel,
      category?.title,
      category?.short,
      (p.tags || []).join(' '),
    ].join(' '),
  );
}

function matchesQuery(p, q) {
  if (!q) return true;
  const haystack = searchableText(p);
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/**
 * جست‌وجوی مستقیم در کل کاتالوگ، مستقل از دسته و فیلترهای جاری.
 * تطبیق نام دقیق/آغاز نام محصول را جلوتر از تطبیق توضیحات قرار می‌دهد تا
 * پیشنهاد نخست برای انتخاب مستقیم، نزدیک‌ترین محصول به عبارت کاربر باشد.
 */
export function searchProducts(query, { limit = 8 } = {}) {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const tokens = q.split(/\s+/).filter(Boolean);
  const rank = (p) => {
    const name = normalizeSearchText(p.product);
    const bank = normalizeSearchText(p.bank);
    if (name === q) return 1000;
    if (name.startsWith(q)) return 800;
    if (bank === q) return 700;
    if (bank.startsWith(q)) return 600;
    if (tokens.every((token) => name.includes(token))) return 500;
    if (tokens.every((token) => bank.includes(token))) return 400;
    return 0;
  };

  const max = Number.isFinite(Number(limit)) ? Math.max(0, Math.trunc(Number(limit))) : 8;
  return store.products
    .map((product, index) => ({ product, index, rank: rank(product), text: searchableText(product) }))
    .filter(({ text }) => tokens.every((token) => text.includes(token)))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, max)
    .map(({ product }) => product);
}

/**
 * اعمال فیلترها و مرتب‌سازی روی محصولات دسته فعال.
 * @param {{ignoreCategory?:boolean}} [opts]
 */
export function filtered(opts = {}) {
  const f = store.filters;
  const q = normalizeSearchText(f.query);

  // «کنترل‌شده بودن» یک رکورد یعنی خط لوله آن را دیده باشد — ملاک، جدیدترین
  // تاریخ بازبینی (lastSeen) یا به‌روزرسانی منبع (lastUpdated) است. اگر فقط
  // lastUpdated ملاک گرفته شود، رکوردی که دیروز واکشی شده ولی صفحه منبعش
  // ماه‌هاست دست‌نخورده مانده، غیابی «فقط کنترل‌شده» محسوب می‌شود.
  // «کنترل‌شده بودن» برای فیلتر onlyFresh: جدیدترینِ تاریخ بازبینی خط لوله
  // یا تاریخ به‌روزرسانی خود منبع (صفحه‌ای که بانک تازه ویرایش کرده، تازه است).
  const checkedAge = (p) => daysSince(mostRecent(p.lastUpdated, p.lastSeen));

  let rows = store.products.filter((p) => {
    if (!opts.ignoreCategory && p.category !== f.category) return false;
    if (!matchesQuery(p, q)) return false;
    if (f.bank !== 'all' && p.bank !== f.bank) return false;
    if (f.minScore > 0 && scoreOf(p.id) < f.minScore) return false;
    if (f.channel === 'online' && p.digital < 75) return false;
    if (f.channel === 'branch' && p.digital >= 75) return false;
    if (f.collateral === 'none' && !['none', 'credit-score'].includes(p.collateralKind)) return false;
    if (f.collateral === 'no-guarantor' && !['none', 'credit-score'].includes(p.collateralKind)) return false;
    if (f.confidence !== 'all' && p.confidence !== f.confidence) return false;
    // نوع عقد فقط برای محصولات اعتباری معنا دارد؛ در سایر دسته‌ها این فیلتر
    // خنثی است تا انتخاب کاربر هنگام جابه‌جایی بین دسته‌ها نتایج را خالی نکند.
    if (isCreditCategory(f.category) && f.contract !== 'all' && p.contractType !== f.contract) return false;
    if (f.onlyFresh && checkedAge(p) > 60) return false;
    if (f.onlyStale && !p.stale) return false;
    return true;
  });

  const sorters = {
    score: (a, b) => scoreOf(b.id) - scoreOf(a.id),
    fresh: (a, b) => checkedAge(a) - checkedAge(b),
    rate: (a, b) => (b.rate || 0) - (a.rate || 0),
    speed: (a, b) => b.speed - a.speed,
    digital: (a, b) => b.digital - a.digital,
    ceiling: (a, b) => (b.maxAmount || 0) - (a.maxAmount || 0),
    name: (a, b) => a.bank.localeCompare(b.bank, 'fa'),
  };

  rows = [...rows].sort(sorters[f.sort] ?? sorters.score);
  return rows;
}

/** شمار محصولات هر نوع عقد در یک دسته — برای شمارنده گزینه‌های فیلتر */
export function contractCounts(category) {
  const counts = { all: 0 };
  for (const k of CONTRACT_KEYS) counts[k] = 0;
  for (const p of store.products) {
    if (p.category !== category) continue;
    counts.all += 1;
    counts[p.contractType] = (counts[p.contractType] ?? 0) + 1;
  }
  return counts;
}

/** فهرست بانک‌های موجود در داده فعلی */
export function availableBanks() {
  const set = new Set(store.products.map((p) => p.bank));
  return [...set].sort((a, b) => a.localeCompare(b, 'fa'));
}

/** بانک‌های موجود فقط در یک دسته */
export function availableBanksIn(category) {
  const set = new Set(store.products.filter((p) => p.category === category).map((p) => p.bank));
  return [...set].sort((a, b) => a.localeCompare(b, 'fa'));
}

/* ---------- آمار کلی ---------- */

export function summary() {
  const products = store.products;
  const byCategory = Object.keys(CATEGORY_META).reduce((a, k) => {
    a[k] = products.filter((p) => p.category === k).length;
    return a;
  }, {});

  const scores = products.map((p) => scoreOf(p.id));

  // دو سنجه مستقل:
  //   verified30 — رکوردهایی که خط لوله در ۳۰ روز گذشته بازبینی کرده است
  //   sourceFresh30 — رکوردهایی که خود منبع در ۳۰ روز گذشته به‌روز شده است
  // تفکیک این دو مهم است: داده‌ای می‌تواند «تازه کنترل‌شده» ولی «منبع کهنه»
  // باشد، و برعکس. نمایش یک عدد به‌جای هر دو، تصویر نادرست می‌دهد.
  // فقط مهرهای «دیدن/تأیید» ملاک است. پیش‌تر lastUpdated هم حساب می‌شد و
  // رکوردی که منبعش تصادفاً تازه بود، «بازبینی‌شده» شمرده می‌شد؛ نتیجه،
  // عددی خوش‌بینانه بود که با گزارش هفتگی نمی‌خواند (یافتهٔ F9 ممیزی).
  const verifiedAt = (p) => mostRecent(p.lastSeen, p.lastVerified, p.source?.checked);
  const verified30 = products.filter((p) => {
    const d = verifiedAt(p);
    return d ? daysSince(d) <= 30 : false;
  }).length;
  const sourceFresh30 = products.filter((p) => daysSince(p.lastUpdated) <= 30).length;
  const stale = products.filter((p) => p.stale).length;
  const auto = products.filter((p) => p.autoDiscovered).length;
  const missingDate = products.filter((p) => !p.lastUpdated).length;

  return {
    total: products.length,
    banks: new Set(products.map((p) => p.bank)).size,
    byCategory,
    verified30,
    sourceFresh30,
    stale,
    auto,
    missingDate,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    maxScore: scores.length ? Math.max(...scores) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
    confidence: {
      high: products.filter((p) => p.confidence === 'high').length,
      medium: products.filter((p) => p.confidence === 'medium').length,
      low: products.filter((p) => p.confidence === 'low').length,
    },
    // محاسبه از رکوردهای فعلی است؛ امتیاز فایل گزارش هفتگی تاریخی است و
    // از فرمول متفاوتی استفاده می‌کند، پس نباید به‌جای وضعیت امروز نمایش یابد.
    health: Math.round(clamp(
      (verified30 / Math.max(1, products.length)) * 45 +
        (sourceFresh30 / Math.max(1, products.length)) * 20 +
        (products.filter((p) => p.confidence === 'high').length / Math.max(1, products.length)) * 20 +
        (1 - stale / Math.max(1, products.length)) * 15,
      0, 100,
    )),

  };
}

/** اعمال یک پروفایل وزن */
export function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  store.weights = { ...preset.w };
  store.activePreset = key;
  saveWeights();
  recalculate();
}

export { PRESETS };

/**
 * وضعیت مرکزی سامانه: بارگذاری داده، فیلترها، مرتب‌سازی و ماندگاری انتخاب‌ها.
 *
 * راهبرد بارگذاری داده:
 *   ۱. data/bundle.js از طریق تگ script بارگذاری می‌شود → روی file:// هم کار می‌کند
 *   ۲. در محیط وب، data/products.json تازه‌تر از بسته بررسی و در صورت تفاوت جایگزین می‌شود
 *   ۳. در نبود هر دو، پیام خطای قابل‌فهم نمایش داده می‌شود (نه صفحه سفید)
 */

import { storage, daysSince, clamp } from './util.js';
import { DEFAULT_WEIGHTS, scoreProduct, PRESETS, mostRecent } from './score.js';

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
 *   • قرض‌الحسنه — کارمزد یک‌بار روی اصل، بدون سود مرکب (rateKind: 'fee').
 *   • عقود مشارکتی — مضاربه، مشارکت مدنی و مانند آن‌ها.
 *   • عقود غیرمشارکتی (مبادله‌ای) — مرابحه، مزارعه، اجاره و مانند آن‌ها.
 *
 * فیلد اختیاری «contractType» در داده، نوع عقد را صریح ثبت می‌کند. در نبود
 * آن، نوع عقد به‌صورت قطعی از خود رکورد استنتاج می‌شود (deriveContractType)
 * تا رکوردهای تازه‌وارد هم بدون دخالت خط لوله تفکیک‌پذیر بمانند.
 */
export const CONTRACT_META = {
  qarz: { label: 'قرض‌الحسنه', short: 'قرض‌الحسنه', hint: 'کارمزد یک‌بار روی کل اصل؛ بدون سود مرکب' },
  'non-partnership': { label: 'عقود غیرمشارکتی (مبادله‌ای)', short: 'غیرمشارکتی', hint: 'مرابحه، مزارعه، اجاره و مانند آن‌ها' },
  partnership: { label: 'عقود مشارکتی', short: 'مشارکتی', hint: 'مضاربه و مشارکت' },
  unknown: { label: 'نامشخص', short: 'نامشخص', hint: 'نوع عقد در داده ثبت نشده است' },
};

export const CONTRACT_KEYS = Object.keys(CONTRACT_META);

/** دسته‌هایی که «نوع عقد» برای آن‌ها معنا دارد (محصولات اعتباری) */
export const isCreditCategory = (category) => category === 'loans' || category === 'credit';

/**
 * استنتاج قطعی نوع عقد از رکورد.
 *
 * ترتیب قواعد اهمیت دارد:
 *   ۱. rateKind 'fee' → قطعاً قرض‌الحسنه (این تفکیک را موتور مالی هم همین‌طور می‌داند).
 *   ۲. ذکر صریح قرض‌الحسنه در متن + نرخ پایین (≤۱۰٪) → قرض‌الحسنه؛
 *      پوشش رکوردهایی که rateKind اشتباه ثبت شده ولی ماهیت عقد روشن است.
 *   ۳. تسهیلات سودمحور: ذکر صریح مشارکت/مضاربه → مشارکتی؛ وگرنه غیرمشارکتی.
 *      تسهیلات سودمحور در ایران بر پایه عقد مبادله‌ای یا مشارکتی بسته می‌شود و
 *      غلبه عملی و سقف‌های مصوب (۲۳٪ غیرمشارکتی در برابر ۲۴٪ مشارکتی) نشان
 *      می‌دهد که در نبود ذکر صریح، مبنای معقول عقد مبادله‌ای (غیرمشارکتی) است.
 *   ۴. بقیه (غیرنرخ‌دار و…) → نامشخص؛ ادعایی نمی‌شود.
 *
 * @param {object} p محصول نرمال‌شده
 * @returns {'qarz'|'non-partnership'|'partnership'|'unknown'}
 */
export function deriveContractType(p) {
  const rate = Number(p?.rate) || 0;
  if (p?.rateKind === 'fee') return 'qarz';

  const text = [
    p?.product ?? '',
    p?.desc ?? '',
    Array.isArray(p?.tags) ? p.tags.join(' ') : '',
    p?.extra?.loanType ?? '',
  ].join(' ');

  if (/قرض[\s\u200c]*الحسنه/.test(text) && rate > 0 && rate <= 10) return 'qarz';

  if (p?.rateKind === 'profit' && rate > 0) {
    return /مشارکت|مضاربه/.test(text) ? 'partnership' : 'non-partnership';
  }

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
    lastSeen: raw.lastSeen || null,
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
    if (baseGeneratedAt && json.generatedAt && json.generatedAt <= baseGeneratedAt) return null;
    return json;
  } catch {
    return null;
  }
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
      store.meta.lastRun = json.generatedAt;
      store.meta.loadSource = 'json';
    }

    try {
      const indRes = await fetch(`data/indicators.json?_t=${Date.now()}`, { cache: 'no-store' });
      if (indRes.ok) {
        const indJson = await indRes.json();
        if (indJson?.inflationAnnual) store.indicators = indJson;
      }
    } catch {
      // استفاده از شاخص‌های موجود
    }

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
  // شاخص‌های کلان، بازه‌های مصوب و فهرست بانک‌ها فقط در بسته درون‌خطی هستند
  // (products.json تنها محصولات را دارد)؛ پس حتی وقتی نسخه تازه‌تر JSON
  // جایگزین می‌شود، این بخش‌ها از بسته خوانده می‌شوند.
  store.indicators = bundled?.indicators ?? {};
  store.ranges = bundled?.ranges ?? {};
  store.derived = bundled?.derived ?? {};
  store.period = bundled?.period ?? '';
  store.meta = { ...(bundled?.meta ?? {}), loadSource: source };
  // وقتی نسخه تازه‌تر JSON جایگزین می‌شود، شمارش‌ها و مهر اجرا هم باید از همان
  // نسخه بیایند؛ وگرنه مرکز داده آمار کهنه بسته را نشان می‌دهد.
  if (fresh) {
    if (fresh.counts) store.meta.counts = fresh.counts;
    if (fresh.generatedAt) {
      store.meta.generatedAt = fresh.generatedAt;
      store.meta.lastRun = fresh.generatedAt;
    }
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

const normSearch = (s) =>
  String(s ?? '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .toLowerCase()
    .trim();

function matchesQuery(p, q) {
  if (!q) return true;
  const haystack = normSearch(
    [p.bank, p.product, p.desc, p.audience, p.collateral, (p.tags || []).join(' ')].join(' '),
  );
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/**
 * اعمال فیلترها و مرتب‌سازی روی محصولات دسته فعال.
 * @param {{ignoreCategory?:boolean}} [opts]
 */
export function filtered(opts = {}) {
  const f = store.filters;
  const q = normSearch(f.query);

  // «کنترل‌شده بودن» یک رکورد یعنی خط لوله آن را دیده باشد — ملاک، جدیدترین
  // تاریخ بازبینی (lastSeen) یا به‌روزرسانی منبع (lastUpdated) است. اگر فقط
  // lastUpdated ملاک گرفته شود، رکوردی که دیروز واکشی شده ولی صفحه منبعش
  // ماه‌هاست دست‌نخورده مانده، غیابی «فقط کنترل‌شده» محسوب می‌شود.
  const checkedAge = (p) => daysSince(mostRecent(p.lastUpdated, p.lastSeen));

  let rows = store.products.filter((p) => {
    if (!opts.ignoreCategory && p.category !== f.category) return false;
    if (!matchesQuery(p, q)) return false;
    if (f.bank !== 'all' && p.bank !== f.bank) return false;
    if (f.minScore > 0 && scoreOf(p.id) < f.minScore) return false;
    if (f.channel === 'online' && p.digital < 75) return false;
    if (f.channel === 'branch' && p.digital >= 75) return false;
    if (f.collateral === 'none' && !['none', 'credit-score'].includes(p.collateralKind)) return false;
    if (f.collateral === 'no-guarantor' && p.collateralKind === 'guarantor') return false;
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
  const verified30 = products.filter(
    (p) => daysSince(mostRecent(p.lastUpdated, p.lastSeen)) <= 30,
  ).length;
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
    /** امتیاز سلامت کل داده: ترکیب تازگی، اطمینان و پوشش */
    /**
     * امتیاز سلامت مجموعه داده.
     *
     * پوشش بازبینی مهم‌ترین عامل است (۴۵) چون نشان می‌دهد خط لوله کار می‌کند.
     * تازگی خودِ منبع وزن سبک‌تری دارد (۲۰) چون به رفتار بانک‌ها بستگی دارد
     * و در اختیار این سامانه نیست. اطمینان منبع ۲۰ و نبود رکورد منقضی ۱۵.
     */
    health: Math.round(
      clamp(
        (verified30 / Math.max(1, products.length)) * 45 +
          (sourceFresh30 / Math.max(1, products.length)) * 20 +
          (products.filter((p) => p.confidence === 'high').length / Math.max(1, products.length)) * 20 +
          (1 - stale / Math.max(1, products.length)) * 15,
        0,
        100,
      ),
    ),
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

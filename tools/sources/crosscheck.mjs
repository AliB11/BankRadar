/**
 * منبع: تطبیق مستقل (cross-check) نرخ‌های مرجع با منابع جایگزین.
 *
 * چرا لازم است: منبع اصلی نرخ سپرده (دیجی‌شهر) از بیرون ایران ژئوبلاک است و
 * منبع رسمی بانک مرکزی فقط نرخ‌های سیاستی را منتشر می‌کند، نه سقف سپرده‌های
 * عادی را در یک جدول ماشین‌خوان. اگر تنها یک منبع رسانه‌ای بماند، خطا در آن
 * منبع بی‌سروصدا وارد داده می‌شود.
 *
 * این ماژول هیچ عددی را خودکار بازنویسی نمی‌کند؛ فقط «توافق/اختلاف» را ثبت
 * می‌کند تا اختلاف منابع دیده شود. تصمیم نهایی با انسان است.
 */

import { fetchResilient, summarizeAttempts } from '../lib/resilience.mjs';
import { normalizeText, stripTags, toNumber } from '../lib/parse.mjs';

/**
 * منابع جایگزینِ تطبیق مستقل.
 *
 * تاریخچهٔ اعتبارسنجی:
 *   - ۱۲ آبان ۱۴۰۵: FinAI و نبض قیمت با آزمون زنده تأیید شدند.
 *   - ۱۳ آبان ۱۴۰۵ (بازآزمایی زنده): یک مثبت کاذب در `classifyContent` دو صفحهٔ
 *     سالم را «پیدا نشد» شمرده بود (کلاس‌های `.error-404` در CSS قالب وردپرس +
 *     زیررشتهٔ ۴۰۴ داخل عدد سال «۱۴۰۴»)؛ در `tools/lib/resilience.mjs` اصلاح شد.
 *   - ۱۳ آبان ۱۴۰۵: «خانهٔ سرمایه» به‌عنوان منبع سوم افزوده و با آزمون زنده
 *     تأیید شد (هر شش سقف سپرده: ۵/۱۲/۱۷/۲۰٫۵/۲۱٫۵/۲۲٫۵ — هم‌خوان با شاخص‌ها).
 *     نتیجهٔ نهایی: هر شاخص سقف سپرده با سه منبع مستقل تأیید می‌شود؛ تک‌منبعی
 *     شدن تطبیق مستقل — ریسک ثبت‌شده در §۷.۴ ممیزی — از بین می‌رود.
 */
export const ALT_SOURCES = [
  {
    id: 'finai',
    label: 'FinAI — جدول سقف سود سپرده ۱۴۰۵',
    url: 'https://finai.ir/blog/bank-deposit-interest-1405',
    kind: 'aggregator',
    covers: ['depositCap1y', 'depositCap2y', 'depositCap3y'],
  },
  {
    id: 'khanesarmaye',
    label: 'خانهٔ سرمایه — جدول نرخ سپرده بانک‌ها ۱۴۰۵',
    url: 'https://bank.khanesarmaye.com/blog/bank-interest',
    kind: 'aggregator',
    covers: ['depositShortNormal', 'depositShort3m', 'depositShort6m', 'depositCap1y', 'depositCap2y', 'depositCap3y'],
  },
  {
    id: 'nabzgheymat',
    label: 'نبض قیمت — نرخ سود سپرده آبان ۱۴۰۵',
    url: 'https://nabzgheymat.ir/%D8%B3%D9%88%D8%AF-%D8%B3%D9%BE%D8%B1%D8%AF%D9%87-%D8%A8%D8%A7%D9%86%DA%A9%DB%8C-%D8%AF%D8%B1-%D8%A2%D8%A8%D8%A7%D9%86-%DB%B1%DB%B4%DB%B0%DB%B5-%DA%86%D9%82%D8%AF%D8%B1-%D8%A7%D8%B3%D8%AA-%E2%94%82/',
    kind: 'press',
    covers: ['depositCap1y', 'depositCap2y', 'depositCap3y', 'depositShort3m', 'depositShort6m', 'depositShortNormal'],
  },
];

/**
 * یکسان‌سازی متن سلول: ارقام فارسی→لاتین، حذف نیم‌فاصله، ممیز فارسی→نقطه.
 * نیم‌فاصله مهم است: «سه‌ماهه» و «یک‌ساله» با ZWNJ نوشته می‌شوند و الگوی
 * `\s*` آن را نمی‌گیرد؛ بدون این یکسان‌سازی، نیمی از سررسیدها از دست می‌رود.
 */
const squash = (value) =>
  normalizeText(stripTags(value)).replace(/\u200c/g, '').replace(/٫/g, '.');

/** الگوی هر سررسید در جدول‌های فارسی */
const TERM_PATTERNS = {
  depositShortNormal: [/کوتاه\s*مدت\s*عادی/, /سپرده\s*عادی/],
  depositShort3m: [/(?:سه|۳|3)\s*[- ]?ماهه/],
  depositShort6m: [/(?:شش|۶|6)\s*[- ]?ماهه/],
  depositCap1y: [/(?:یک|۱|1)\s*[- ]?ساله/],
  depositCap2y: [/(?:دو|۲|2)\s*[- ]?ساله/],
  depositCap3y: [/(?:سه|۳|3)\s*[- ]?ساله/],
};

/**
 * استخراج نرخ‌ها از سلول‌های جدول یک صفحهٔ فارسی.
 * هر سلول برچسب که الگوی یک سررسید را داشته باشد، عدد درصدی همان سطر را می‌گیرد.
 *
 * @param {string} html
 * @returns {Record<string, number>} مثلاً `{ depositCap1y: 20.5 }`
 */
export function parseCapTable(html) {
  const cells = [...String(html ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => squash(m[1]));
  const found = {};
  const rateOf = (text) => {
    const m = String(text).match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:%|٪|درصد)/);
    if (!m) return null;
    const n = toNumber(m[1]);
    return n != null && n > 0 && n <= 40 ? n : null;
  };

  for (let i = 0; i < cells.length; i += 1) {
    const label = cells[i];
    if (!label || label.length > 70) continue;
    for (const [key, patterns] of Object.entries(TERM_PATTERNS)) {
      if (found[key] != null) continue;
      if (!patterns.some((re) => re.test(label))) continue;
      // نرخ در همان سلول یا یکی‌دو سلول بعد
      const candidates = [label, cells[i + 1], cells[i + 2]].filter(Boolean);
      const rate = candidates.map(rateOf).find((n) => n != null);
      if (rate != null) found[key] = rate;
    }
  }
  return found;
}

/**
 * استخراج نرخ بین‌بانکی از جمله‌های متنی (وقتی جدول در دسترس نیست).
 * @param {string} html
 */
export function parseInterbank(html) {
  const text = squash(html);
  // عدد درصدی را در پنجرهٔ بعد از «بین‌بانکی» می‌گیریم، نه بلافاصله بعد از آن:
  // جمله‌های فارسی معمولاً تاریخ و عددهای دیگر را وسط می‌آورند («هفته منتهی به
  // ۹ مهر روی ۲۴ درصد»).
  const window = text.match(/بین\s*بانکی([\s\S]{0,100})/);
  if (!window) return null;
  const candidates = [...window[1].matchAll(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|٪|درصد)/g)].map((m) => toNumber(m[1]));
  const n = candidates.find((v) => v != null && v > 0 && v <= 60) ?? null;
  return n;
}

const same = (a, b, tolerance = 0.05) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

/**
 * واکشی منابع جایگزین و مقایسه با شاخص‌های ثبت‌شده.
 *
 * @param {object} indicators محتوای data/indicators.json
 * @param {{log?:Function, now?:() => Date, sources?:typeof ALT_SOURCES}} [opts]
 */
export async function collect(indicators, opts = {}) {
  const { log = () => {}, now = () => new Date(), sources = ALT_SOURCES } = opts;
  const observations = [];
  const sourceReports = [];

  for (const source of sources) {
    try {
      const page = await fetchResilient(source.url, {
        allowWayback: true,
        allowProxy: true,
        timeout: 25_000,
        retries: 1,
        now,
      });
      const caps = parseCapTable(page.text);
      const interbank = parseInterbank(page.text);
      const values = { ...caps, ...(interbank != null ? { interbankRate: interbank } : {}) };
      observations.push({
        source: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        via: page.via,
        observedAt: page.observedAt,
        ageDays: page.ageDays,
        values,
      });
      sourceReports.push({
        name: source.id,
        ok: Object.keys(values).length > 0,
        via: page.via,
        observedAt: page.observedAt,
        ageDays: page.ageDays,
        chain: summarizeAttempts(page.attempts),
        values: Object.keys(values).length,
      });
      log(`تطبیق ${source.label}: ${JSON.stringify(values)} (${page.via})`);
    } catch (err) {
      sourceReports.push({ name: source.id, ok: false, error: err.message, chain: summarizeAttempts(err.attempts ?? []) });
      log(`تطبیق ${source.label}: ناموفق — ${err.message}`);
    }
  }

  const keys = [...new Set(observations.flatMap((o) => Object.keys(o.values)))].sort();
  const checks = keys.map((key) => {
    const ours = indicators?.indicators?.[key]?.value ?? null;
    const seen = observations
      .filter((o) => Number.isFinite(o.values[key]))
      .map((o) => ({ source: o.source, url: o.url, via: o.via, observedAt: o.observedAt, value: o.values[key] }));
    const agrees = seen.filter((s) => same(s.value, ours));
    const status = !seen.length ? 'unverified' : agrees.length ? 'match' : 'mismatch';
    return {
      key,
      label: indicators?.indicators?.[key]?.label ?? key,
      ours,
      period: indicators?.indicators?.[key]?.period ?? null,
      status,
      observations: seen,
    };
  });

  return {
    source: 'crosscheck',
    generatedAt: now().toISOString(),
    checks,
    sources: sourceReports,
    summary: {
      matched: checks.filter((c) => c.status === 'match').length,
      mismatched: checks.filter((c) => c.status === 'mismatch').length,
      unverified: checks.filter((c) => c.status === 'unverified').length,
    },
  };
}

/**
 * منبع: شاخص‌های کلان (تورم، نرخ بین‌بانکی، نرخ مرجع).
 *
 * این ماژول تلاش می‌کند آخرین اعداد را از منابع عمومی استخراج کند و در صورت
 * شکست، مقادیر پایه تأییدشده در data/indicators.json را دست‌نخورده نگه می‌دارد.
 * اصل طراحی: داده کلان هرگز نباید حذف شود، فقط می‌تواند به‌روزرسانی شود.
 */

import { get, runSource } from '../lib/http.mjs';
import { normalizeText, stripTags, toNumber } from '../lib/parse.mjs';
import { todayJalali, PERSIAN_MONTHS } from '../lib/jalali.mjs';

/** تبدیل ارقام لاتین به فارسی برای نمایش در رابط */
function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}


/** منابع خبری/رسمی که عدد تورم و نرخ‌های کلان را منتشر می‌کنند */
const MACRO_SOURCES = [
  {
    id: 'amar-cpi',
    label: 'مرکز آمار ایران — شاخص قیمت مصرف‌کننده',
    url: 'https://www.amar.org.ir/english/Statistics-by-Topic/Consumer-Price-Index',
    kind: 'regulator',
    trustedForInflation: true,
  },
  {
    id: 'cbi-inflation',
    label: 'بانک مرکزی — گزارش تحولات اقتصادی',
    url: 'https://www.cbi.ir/simplelist/1466.aspx',
    kind: 'regulator',
  },
  {
    id: 'rade-news',
    label: 'رده — اخبار و تحلیل بانکی',
    url: 'https://www.rade.ir/',
    kind: 'aggregator',
  },
];

/**
 * تلاش برای یافتن «تورم سالانه» در متن یک صفحه.
 * الگوی فارسی: «تورم سالانه ... ۶۹.۹ درصد» یا «تورم نقطه به نقطه ... ۸۹ درصد»
 * @param {string} text
 * @returns {{annual:number|null, pointToPoint:number|null, monthly:number|null, period:string|null}}
 */
export function extractInflation(text) {
  const t = normalizeText(stripTags(text)).replace(/٫/g, '.').replace(/(\d)\/(\d)/g, '$1.$2');

  const grab = (patterns) => {
    for (const p of patterns) {
      const m = t.match(p);
      if (m) {
        const n = toNumber(m[1]);
        if (n != null && n > 0 && n < 300) return n;
      }
    }
    return null;
  };

  const annual = grab([
    /تورم\s*سالانه[^\d]{0,60}?(\d{1,3}(?:\.\d{1,2})?)\s*(?:درصد|٪)/,
    /(\d{1,3}(?:\.\d{1,2})?)\s*(?:درصد|٪)[^\d]{0,40}?تورم\s*سالانه/,
  ]);
  const pointToPoint = grab([
    /تورم\s*نقطه\s*به\s*نقطه[^\d]{0,60}?(\d{1,3}(?:\.\d{1,2})?)\s*(?:درصد|٪)/,
  ]);
  const monthly = grab([
    /تورم\s*ماهانه[^\d]{0,60}?(\d{1,3}(?:\.\d{1,2})?)\s*(?:درصد|٪)/,
  ]);

  const periodMatch = t.match(/(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(?:ماه\s*)?(\d{4})/);

  return {
    annual,
    pointToPoint,
    monthly,
    period: periodMatch ? `${periodMatch[1]} ${periodMatch[2]}` : null,
  };
}

/**
 * تلاش برای یافتن نرخ سود سپرده/تسهیلات مصوب در متن.
 * @param {string} text
 */
export function extractPolicyRates(text) {
  const t = normalizeText(stripTags(text)).replace(/(\d)\/(\d)/g, '$1.$2');
  const out = {};

  const deposit1y = t.match(/سپرده[^\d]{0,80}?(?:یک|1)\s*سال[^\d]{0,40}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:درصد|٪)/);
  if (deposit1y) out.depositCap1y = toNumber(deposit1y[1]);

  const loanCap = t.match(/(?:تسهیلات|عقود\s*غیرمشارکتی)[^\d]{0,80}?(?:حداکثر|سقف)?[^\d]{0,20}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:درصد|٪)/);
  if (loanCap) out.loanRateCeiling = toNumber(loanCap[1]);

  const interbank = t.match(/بین\s*بانکی[^\d]{0,60}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:درصد|٪)/);
  if (interbank) out.interbankRate = toNumber(interbank[1]);

  const qarz = t.match(/قرض‌?\s*الحسنه[^\d]{0,60}?(\d{1,2})\s*(?:درصد|٪)/);
  if (qarz) out.qarzRate = toNumber(qarz[1]);

  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v > 0 && v <= 50));
}

/** کلید ترتیبی ماه جلالی؛ دوره نامعلوم برای جایگزینی کافی نیست. */
export function macroPeriodIndex(period) {
  const text = normalizeText(period ?? '');
  const m = text.match(/(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(?:ماه\s*)?(\d{4})/);
  if (!m) return null;
  const month = PERSIAN_MONTHS.indexOf(m[1]);
  const year = Number(m[2]);
  return month < 0 || year < 1300 || year > 1600 ? null : year * 12 + month;
}

/**
 * هر عدد و دوره و منبع از یک مشاهده می‌آید. منبع‌های کلی/بی‌دوره فقط برای
 * بررسی ثبت می‌شوند، نه انتشار خودکار؛ میانگین‌گیری بین دوره‌ها ممنوع است.
 * نرخ‌های سیاستی استخراج‌شده از صفحه عمومی نیز نیاز به تأیید انسانی دارند.
 */
export function mergeMacroObservations(base, found, opts = {}) {
  const merged = structuredClone(base);
  const touched = [];
  const j = opts.todayJalali ?? todayJalali();
  const currentPeriod = j.jy * 12 + j.jm - 1;
  const fields = [
    ['annual', 'inflationAnnual', 5, 200],
    ['pointToPoint', 'inflationPointToPoint', 0, 300],
    ['monthly', 'inflationMonthly', 0, 100],
  ];
  for (const [field, key, min, max] of fields) {
    const previous = merged.indicators?.[key];
    if (!previous) continue;
    const prevPeriod = macroPeriodIndex(previous.period);
    const eligible = found.filter((f) => {
      const value = f.inflation?.[field];
      const period = macroPeriodIndex(f.inflation?.period);
      return f.trustedForInflation === true && /^https?:\/\//.test(f.url ?? '') &&
        Number.isFinite(value) && value >= min && value < max && period != null &&
        period <= currentPeriod && (prevPeriod == null || period > prevPeriod);
    }).sort((a, b) => macroPeriodIndex(b.inflation.period) - macroPeriodIndex(a.inflation.period));
    const selected = eligible[0];
    if (!selected) continue;
    const value = selected.inflation[field];
    merged.indicators[key] = {
      ...previous,
      previousValue: previous.value,
      value,
      period: toPersianDigits(selected.inflation.period),
      source: { kind: selected.kind, title: selected.label, url: selected.url },
      changedAt: opts.now ?? new Date().toISOString(),
    };
    touched.push(`${key}: ${previous.value} → ${value}`);
  }

  const inflation = merged.indicators?.inflationAnnual?.value;
  const cbiInflation = merged.indicators?.inflationCbiAnnual?.value;
  const deposit = merged.indicators?.depositCap1y?.value;
  const fisher = (nominal, inf) => Number((((1 + nominal / 100) / (1 + inf / 100) - 1) * 100).toFixed(1));
  merged.derived = {
    ...merged.derived,
    note: 'بازده حقیقی بر پایه رابطه فیشر: (۱ + سود اسمی) ÷ (۱ + تورم) − ۱؛ منفی یعنی افت قدرت خرید.',
    ...(Number.isFinite(deposit) && Number.isFinite(inflation) ? { realDepositReturnAnnual: fisher(deposit, inflation) } : {}),
    ...(Number.isFinite(deposit) && Number.isFinite(cbiInflation) ? { realDepositReturnCbi: fisher(deposit, cbiInflation) } : {}),
  };
  return { indicators: merged, touched };
}

/**
 * واکشی شاخص‌های کلان و ادغام با مقادیر پایه.
 * @param {object} base محتوای فعلی data/indicators.json
 * @param {{log?:Function}} [opts]
 */
export async function collect(base, opts = {}) {
  const { log = () => {} } = opts;
  const found = [];
  const failures = [];

  for (const source of MACRO_SOURCES) {
    const result = await runSource(source.id, async () => {
      const html = await get(source.url, { timeout: 25_000, retries: 1 });
      const inflation = extractInflation(html);
      const rates = extractPolicyRates(html);
      return { inflation, rates };
    });

    if (result.ok) {
      const { inflation, rates } = result.data;
      found.push({ source: source.id, label: source.label, url: source.url, kind: source.kind, trustedForInflation: source.trustedForInflation === true, inflation, rates });
      log(`${source.label}: ${JSON.stringify({ ...inflation, ...rates })}`);
    } else {
      failures.push({ source: source.id, label: source.label, error: result.error });
      log(`${source.label}: ناموفق — ${result.error}`);
    }
  }

  const { indicators: merged, touched } = mergeMacroObservations(base, found);

  const j = todayJalali();
  merged.generatedAt = new Date().toISOString();

  // «period» برچسب بازه گزارش‌دهی است و در سرصفحه سامانه نمایش داده می‌شود.
  // نوشتن تاریخ خام در آن، برچسب معنادار قبلی (مثلاً «مرداد ۱۴۰۵») را از بین
  // می‌برد و با لحن فارسی رابط هم‌خوان نیست؛ بنابراین فقط اگر مقدار معناداری
  // وجود نداشته باشد، دوره از تاریخ روز ساخته می‌شود.
  const inflationPeriod = merged.indicators?.inflationAnnual?.period;
  if (inflationPeriod) {
    merged.period = toPersianDigits(inflationPeriod);
  } else if (!merged.period || /^[\d۰-۹]/.test(String(merged.period).trim())) {
    // ماه دوره از تاریخ روز ساخته می‌شود — نه ماه ثابت. پیش‌تر «شهریور» هاردکد
    // شده بود و برچسب دوره در ماه‌های دیگر سال نادرست از آب درمی‌آمد.
    merged.period = toPersianDigits(`${PERSIAN_MONTHS[j.jm - 1] ?? ''} ${j.jy}`);
  }

  return {
    source: 'macro-indicators',
    sourcesTried: MACRO_SOURCES.length,
    sourcesOk: found.length,
    touched,
    failures,
    indicators: merged,
    raw: found,
  };
}

/**
 * منبع: شاخص‌های کلان (تورم، نرخ بین‌بانکی، نرخ مرجع).
 *
 * این ماژول تلاش می‌کند آخرین اعداد را از منابع عمومی استخراج کند و در صورت
 * شکست، مقادیر پایه تأییدشده در data/indicators.json را دست‌نخورده نگه می‌دارد.
 * اصل طراحی: داده کلان هرگز نباید حذف شود، فقط می‌تواند به‌روزرسانی شود.
 */

import { runSource } from '../lib/http.mjs';
import { fetchResilient, summarizeAttempts } from '../lib/resilience.mjs';
import { normalizeText, stripTags, toNumber } from '../lib/parse.mjs';
import { todayJalali, PERSIAN_MONTHS, parseJalaliDate } from '../lib/jalali.mjs';

/** نشانی زندهٔ جدول نرخ سود سیاستی بانک مرکزی (جایگزین simplelist/۲۰۸۸ حذف‌شده) */
export const POLICY_RATES_URL = 'https://www.cbi.ir/PolicyRates/policyrates_fa.aspx';
/** نشانی زندهٔ فهرست اخبار/بخشنامه‌های بانک مرکزی */
export const CBI_NEWS_URL = 'https://www.cbi.ir/category/news.aspx';

/** تبدیل ارقام لاتین به فارسی برای نمایش در رابط */
function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}


/**
 * منابع خبری/رسمی که عدد تورم و نرخ‌های کلان را منتشر می‌کنند.
 *
 * ممیزی ۱۲ آبان ۱۴۰۵: نشانی‌های قدیمی `simplelist/1466.aspx` و `simplelist/2088.aspx`
 * حذف شده‌اند و با کد ۲۰۰ متن «Page Not Found» برمی‌گردانند. نشانی‌های زیر
 * زنده آزموده شده‌اند.
 */
const MACRO_SOURCES = [
  {
    id: 'cbi-policy-rates',
    label: 'بانک مرکزی — نرخ سود سیاستی (جدول هفتگی)',
    url: POLICY_RATES_URL,
    kind: 'regulator',
    trustedForPolicyRates: true,
  },
  {
    id: 'amar-cpi',
    label: 'مرکز آمار ایران — شاخص قیمت مصرف‌کننده',
    url: 'https://www.amar.org.ir/english/Statistics-by-Topic/Consumer-Price-Index',
    kind: 'regulator',
    trustedForInflation: true,
  },
  {
    id: 'cbi-news',
    label: 'بانک مرکزی — اخبار و اطلاعیه‌ها',
    url: CBI_NEWS_URL,
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

/**
 * استخراج جدول نرخ‌های سیاستی بانک مرکزی.
 *
 * ساختار صفحه (آزموده‌شده ۱۲ آبان ۱۴۰۵): هر ردیف پنج سلول دارد —
 * تاریخ شمسی، نرخ بازار بین‌بانکی، حداقل نرخ توافق بازخرید، نرخ اعتبارگیری
 * قاعده‌مند، نرخ سپرده‌گذاری قاعده‌مند. ردیف‌ها از تازه به قدیم می‌آیند.
 *
 * @param {string} html
 * @returns {Array<{date:string, iso:string|null, interbank:number, repoFloor:number, corridorCeiling:number, depositFacility:number}>}
 */
export function extractPolicyRateTable(html) {
  const cells = [...String(html ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
    normalizeText(stripTags(m[1])),
  );
  const rows = [];
  for (let i = 0; i + 4 < cells.length; i += 1) {
    const dateCell = cells[i].replace(/\s/g, '');
    if (!/^1[34-5]\d{2}\/\d{1,2}\/\d{1,2}$/.test(dateCell)) continue;
    const nums = cells.slice(i + 1, i + 5).map((c) => toNumber(c));
    if (nums.some((n) => n == null || n < 0 || n > 100)) continue;
    rows.push({
      date: dateCell,
      iso: parseJalaliDate(dateCell),
      interbank: nums[0],
      repoFloor: nums[1],
      corridorCeiling: nums[2],
      depositFacility: nums[3],
    });
    i += 4;
  }

  // پشتیبان: اگر ساختار جدول عوض شد (یا صفحه از مسیر متنی آمد)، ردیف‌ها را
  // از متن پشت‌سرهم می‌خوانیم؛ تاریخ + چهار عدد.
  if (!rows.length) {
    const text = normalizeText(stripTags(html));
    const re = /(1[34-5]\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}(?:\.\d{1,2})?)\s+(\d{1,2}(?:\.\d{1,2})?)\s+(\d{1,2}(?:\.\d{1,2})?)\s+(\d{1,2}(?:\.\d{1,2})?)/g;
    for (const m of text.matchAll(re)) {
      const nums = m.slice(2).map((x) => toNumber(x));
      if (nums.some((n) => n == null || n < 0 || n > 100)) continue;
      rows.push({
        date: m[1],
        iso: parseJalaliDate(m[1]),
        interbank: nums[0],
        repoFloor: nums[1],
        corridorCeiling: nums[2],
        depositFacility: nums[3],
      });
    }
  }

  return rows;
}

/** «۱۴۰۵/۰۸/۰۷» → «آبان ۱۴۰۵» */
function policyPeriod(dateCell) {
  const m = String(dateCell ?? '').match(/^(\d{4})\/(\d{1,2})\//);
  if (!m) return null;
  const month = PERSIAN_MONTHS[Number(m[2]) - 1];
  return month ? toPersianDigits(`${month} ${m[1]}`) : null;
}

/**
 * نوشتن نرخ‌های سیاستی رسمی در شاخص‌ها.
 *
 * قاعده: فقط منبع رسمی و فقط تاریخی که از تاریخ ثبت‌شده جدیدتر (یا برابر با
 * اصلاح مقدار) است. منبع رسمی بر گزارش رسانه اولویت دارد، اما تاریخ گذشته
 * را بازنویسی نمی‌کند تا داده تازه‌ترِ رسانه‌ای با داده کهنه‌تر رسمی جابه‌جا نشود.
 *
 * @param {object} indicators محتوای data/indicators.json
 * @param {Array<object>} rows خروجی extractPolicyRateTable
 * @param {{now?:string}} [opts]
 */
export function applyPolicyRates(indicators, rows, opts = {}) {
  const merged = structuredClone(indicators);
  const touched = [];
  const nowISO = opts.now ?? new Date().toISOString();

  const latest = [...(rows ?? [])]
    .filter((r) => r && Number.isFinite(r.interbank) && r.iso)
    .sort((a, b) => String(b.iso).localeCompare(String(a.iso)))[0];
  if (!latest) return { indicators: merged, touched, latest: null };

  merged.indicators ??= {};
  const period = policyPeriod(latest.date);

  const put = (key, label, value) => {
    if (!Number.isFinite(value)) return;
    const previous = merged.indicators[key];
    const prevIso = previous?.officialDate ?? null;
    if (prevIso && String(latest.iso) < prevIso) return; // عقب‌گرد ممنوع
    if (previous && previous.value === value && prevIso === latest.iso) return;
    merged.indicators[key] = {
      ...previous,
      label,
      unit: '%',
      value,
      period,
      source: {
        kind: 'regulator',
        title: 'بانک مرکزی — نرخ سود سیاستی (جدول هفتگی رسمی)',
        url: POLICY_RATES_URL,
      },
      officialDate: latest.iso,
      observedDate: latest.date,
      ...(previous ? { previousValue: previous.value } : {}),
      changedAt: nowISO,
    };
    touched.push(`${key}: ${previous?.value ?? '—'} → ${value} (${latest.date})`);
  };

  put('interbankRate', 'نرخ سود بازار بین‌بانکی', latest.interbank);
  put('repoFloorRate', 'حداقل نرخ توافق بازخرید', latest.repoFloor);
  put('corridorCeilingRate', 'نرخ اعتبارگیری قاعده‌مند (سقف کریدور)', latest.corridorCeiling);
  put('depositFacilityRate', 'نرخ سپرده‌گذاری قاعده‌مند', latest.depositFacility);

  return { indicators: merged, touched, latest };
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
  const { log = () => {}, now = () => new Date() } = opts;
  const found = [];
  const failures = [];
  let policyRows = [];

  for (const source of MACRO_SOURCES) {
    const result = await runSource(source.id, async () => {
      const page = await fetchResilient(source.url, {
        allowWayback: true,
        allowProxy: source.allowProxy === true,
        timeout: 25_000,
        retries: 1,
        now,
      });
      const html = page.text;
      const inflation = extractInflation(html);
      const rates = extractPolicyRates(html);
      const table = source.trustedForPolicyRates === true ? extractPolicyRateTable(html) : [];
      return {
        inflation,
        rates,
        table,
        via: page.via,
        observedAt: page.observedAt,
        ageDays: page.ageDays,
        chain: summarizeAttempts(page.attempts),
      };
    });

    if (result.ok) {
      const { inflation, rates, table, via, observedAt, ageDays, chain } = result.data;
      found.push({
        source: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        trustedForInflation: source.trustedForInflation === true,
        inflation,
        rates,
        via,
        ageDays,
      });
      if (table.length) policyRows = policyRows.concat(table);
      log(`${source.label}: ${JSON.stringify({ ...inflation, ...rates })} (${via}${ageDays ? `، ${ageDays} روز کهنه` : ''}; ${chain})`);
    } else {
      failures.push({ source: source.id, label: source.label, url: source.url, error: result.error });
      log(`${source.label}: ناموفق — ${result.error}`);
    }
  }

  const macroMerge = mergeMacroObservations(base, found);
  // نرخ‌های سیاستی از جدول رسمی؛ منبع رسمی بر رسانه اولویت دارد
  const policy = applyPolicyRates(macroMerge.indicators, policyRows, { now: now().toISOString() });
  const merged = policy.indicators;
  const touched = [...macroMerge.touched, ...policy.touched];

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
    policy: {
      rows: policyRows.length,
      latest: policy.latest
        ? { date: policy.latest.date, iso: policy.latest.iso, interbank: policy.latest.interbank }
        : null,
    },
    indicators: merged,
    raw: found,
  };
}

/**
 * منبع: FinAI — جدول «نرخ سود سپرده بانکی» با ستون سقف طرح ویژه هر بانک.
 *
 * چرا این منبع؟ دیجی‌شهر (منبع اصلی نرخ‌های ترجیحی) از بیرون ایران ژئوبلاک است
 * و فقط از راه آرشیو می‌آید؛ FinAI زنده است و علاوه بر سقف‌های مصوب،
 * «سقف طرح ویژه» بانک‌محور با حداقل مانده و یادداشت شرایط را در یک جدول
 * HTML تمیز منتشر می‌کند. این یعنی:
 *   ۱. پوشش بانک‌هایی که در جدول ترجیحی دیجی‌شهر نیستند (سرمایه، صادرات،
 *      پست‌بانک، توسعه صادرات، صنعت و معدن و…) به دسته سپرده اضافه می‌شود؛
 *   ۲. برای بانک‌های مشترک، توافق/اختلاف دو منبع مستقل قابل سنجش است — ریسک
 *      تک‌منبعی شدن نرخ‌های ترجیحی (موضوع §۷.۴ ممیزی) کاهش می‌یابد.
 *
 * ساختار جدول (آزموده‌شده ۱۴۰۵/۰۹/۰۱): هر سطر پنج سلول دارد —
 *   نام بانک | سقف مصوب یک‌ساله | سقف طرح ویژه («تا ۳۰٪») | حداقل مانده | یادداشت
 * چند سطر پایین جدول نمونه‌های محاسبه سود ماهانه‌اند (سلول اول عدد است) و
 * دو سطر هم بانک‌های قرض‌الحسنه با سلول «—»؛ همه بدون نرخ، کنار گذاشته می‌شوند.
 *
 * سیاست نگاشت:
 *   - بانکی که از قبل رکورد «preferential» دارد (هر منبعی) با محصول تکراری
 *     اشتباه گرفته نمی‌شود؛ فقط توافق/اختلاف نرخ در گزارش منبع ثبت می‌گردد.
 *     نرخ‌های ترجیحی از دو منبع با سقف‌های متفاوت گزارش می‌شوند (دیجی‌شهر
 *     پله‌ای و FinAI سقف کلان)؛ بازنویسی خودکار یکی با دیگری ممنوع است.
 *   - بانک بدون رکورد ترجیحی موجود → محصول جدید با شناسهٔ پایدار بدون نرخ
 *     (`<bank>-deposit-pref`) تا تغییر نرخ، شناسه را نشکند؛ اگر بعداً دیجی‌شهر
 *     همان بانک را پوشش دهد، تطبیق دو‌مرحله‌ای ادغام (bankId/کلید بانک) همان
 *     رکورد را به‌روز می‌کند و تکراری نمی‌سازد.
 */

import { fetchResilient, summarizeAttempts } from '../lib/resilience.mjs';
import {
  normalizeText,
  foldForMatch,
  today,
  matchBank,
  makeLatinId,
} from '../lib/parse.mjs';
import { parseBandAmount, cellText, faTomanUnit } from './dgshahr.mjs';
import { benefitFromRate } from './rade.mjs';

export const FINAI_URL = 'https://finai.ir/blog/bank-deposit-interest-1405';
export const FINAI_TITLE = 'FinAI — جدول نرخ سود سپرده بانکی ۱۴۰۵';

/** تبدیل ارقام لاتین به فارسی (قرارداد فیلدهای نمایشی) */
const faDigits = (input) => String(input ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * استخراج سطرهای جدول خلاصهٔ بانک‌ها از HTML صفحه.
 *
 * سلول نخست باید متن بانک باشد نه عددِ نمونه‌های محاسبه («۵۰۰ میلیون | ~۲٫۰۸
 * میلیون | …»)؛ سطرهایی که سلول اولشان با رقم شروع می‌شوند یا کمتر از سه سلول
 * دارند، بخش جدول بانک‌ها نیستند.
 *
 * @param {string} html
 * @returns {Array<{bank:string, approved:number|null, ceiling:number|null,
 *   ceilingText:string, minAmount:number|null, minText:string, note:string}>}
 */
export function parseFinaiTable(html) {
  const out = [];
  for (const rm of String(html ?? '').matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...rm[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      cellText(m[1]),
    );
    if (cells.length < 4) continue;
    const bank = normalizeText(cells[0] || '');
    if (!bank || /^\d/.test(bank)) continue; // سطرهای نمونهٔ محاسبه سود ماهانه

    const rateOf = (text) => {
      const t = normalizeText(text).replace(/٫/g, '.');
      const m = t.match(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:٪|%|درصد)/);
      if (!m) return null;
      const n = Number.parseFloat(m[1]);
      return Number.isFinite(n) && n > 0 && n <= 40 ? n : null;
    };

    const approved = rateOf(cells[1]);
    const ceiling = rateOf(cells[2]);
    if (ceiling == null && approved == null) continue; // بانک قرض‌الحسنه («—»)

    const band = parseBandAmount(cells[3] || '');
    out.push({
      bank,
      approved,
      ceiling: ceiling ?? approved,
      ceilingText: normalizeText(cells[2] || ''),
      minAmount: band.min,
      minText: normalizeText(cells[3] || ''),
      note: normalizeText(cells[4] || ''),
    });
  }
  return out;
}

/**
 * تاریخ مشاهدهٔ محتوا = تاریخ snapshot اگر از آرشیو بیاید، نه تاریخ امروز.
 */
const sourceRef = (checked = today()) => ({
  kind: 'press',
  title: FINAI_TITLE,
  url: FINAI_URL,
  checked,
});

/**
 * نگاشت سطرهای جدول به رکورد محصولات + گزارش تطبیق با رکوردهای موجود.
 * @param {Array} rows خروجی parseFinaiTable
 * @param {{existing?:Array, banks?:Array, observedAt?:string}} [opts]
 * @returns {{products:Array, corroboration:Array<{bank:string, bankId:string,
 *   existingRate:number|null, finaiRate:number|null, agree:boolean}>}}
 */
export function mapToProducts(rows, opts = {}) {
  const { existing = [], banks = [], observedAt = today() } = opts;
  const products = [];
  const corroboration = [];

  for (const row of rows) {
    const bank = matchBank(row.bank, banks);
    if (!bank || bank.id === 'unknown') continue;
    const idBank = /^[a-z0-9][a-z0-9-]*$/.test(bank.id) ? bank.id : makeLatinId('bank', bank.name);
    if (row.ceiling == null) continue;

    // رکورد ترجیحی موجود همان بانک — از هر منبعی (دیجی‌شهر، دستی یا خود FinAI)
    const prev = existing.find(
      (p) =>
        p.category === 'deposits' &&
        p.subcategory === 'preferential' &&
        (p.bankId === bank.id || foldForMatch(p.bank || '') === foldForMatch(bank.name)),
    );

    if (prev) {
      // دو منبع مستقل؛ اختلاف باید دیده شود، نه به‌صورت بی‌صدا بازنویسی
      corroboration.push({
        bank: bank.name,
        bankId: bank.id,
        existingRate: prev.rate ?? null,
        finaiRate: row.ceiling,
        agree: prev.rate != null && Math.abs(prev.rate - row.ceiling) <= 0.51,
      });
      continue;
    }

    products.push({
      id: `${idBank}-deposit-pref`,
      bank: bank.name,
      bankId: bank.id,
      product: `سپرده با سود ترجیحی ${bank.name} (سقف طرح ویژه ${faDigits(row.ceiling)}٪)`,
      category: 'deposits',
      subcategory: 'preferential',
      rate: row.ceiling,
      rateKind: 'profit',
      rateLabel: `سقف نرخ ترجیحی ${faDigits(row.ceiling)}٪ (طرح ویژه — FinAI ۱۴۰۵)`,
      benefit: benefitFromRate(row.ceiling, 'deposits'),
      minAmount: row.minAmount ?? null,
      maxAmount: null,
      amountLabel: row.minAmount ? `از ${faTomanUnit(row.minAmount)} تومان` : row.minText || 'نامشخص',
      termMonths: 12,
      termLabel: 'یک‌ساله — طرح ویژه مانده‌محور',
      speed: 60,
      digital: 70,
      friction: 80,
      collateral: 'ندارد',
      collateralKind: 'none',
      audience: row.minAmount ? `سپرده‌گذاران با مانده ${faTomanUnit(row.minAmount)} تومان به بالا` : 'سپرده‌گذاران متقاضی طرح‌های ویژه',
      desc:
        `سقف نرخ ترجیحی ${bank.name} بر پایه جدول مقایسه‌ای FinAI: سقف مصوب عادی یک‌ساله ${row.approved != null ? faDigits(row.approved) + '٪' : 'نامشخص'} و سقف طرح ویژه تا ${faDigits(row.ceiling)}٪` +
        (row.minText ? ` با حداقل مانده ${row.minText}` : '') +
        (row.note ? `؛ یادداشت منبع: ${row.note}` : '') +
        `. نرخ‌های فراتر از سقف مصوب توافقی‌اند؛ پیش از افتتاح، نرخ و شرایط را از شعبه به‌صورت کتبی بگیرید.`,
      tags: [...new Set(['سود ترجیحی', 'طرح ویژه', bank.name])],
      requirements: [
        row.minText && row.minText !== '—' ? `حداقل مانده: ${row.minText}` : null,
        row.note && row.note !== '—' ? `یادداشت منبع: ${row.note}` : null,
        'سقف مصوب عادی یک‌ساله: ' + (row.approved != null ? `${faDigits(row.approved)}٪` : 'نامشخص'),
      ].filter(Boolean),
      confidence: 'medium',
      autoDiscovered: true,
      lastUpdated: observedAt,
      lastSeen: observedAt,
      lastVerified: observedAt,
      source: sourceRef(observedAt),
    });
  }

  return { products, corroboration };
}

/**
 * واکشی و نگاشت صفحه FinAI.
 * html تزریقی (تست/واردسازی آفلاین) یا FINAI_HTML_FILE بر قرارداد مقدم است.
 * @param {{html?:string, url?:string, existing?:Array, banks?:Array, log?:Function}} opts
 */
export async function collect(opts = {}) {
  const {
    url = FINAI_URL,
    html: injected,
    existing = [],
    banks = [],
    log = () => {},
    now = () => new Date(),
  } = opts;

  let html = injected ?? null;
  let via = html ? 'injected' : 'direct';
  let observedISO = null;
  let chain = 'درون‌ریزی محلی';

  if (!html && process.env.FINAI_HTML_FILE) {
    html = await import('node:fs/promises').then((fs) => fs.readFile(process.env.FINAI_HTML_FILE, 'utf8'));
    via = 'file';
  }
  if (!html) {
    const page = await fetchResilient(url, {
      allowWayback: true,
      allowProxy: true,
      timeout: 30_000,
      retries: 2,
      now,
    });
    html = page.text;
    via = page.via;
    observedISO = page.observedAt;
    chain = summarizeAttempts(page.attempts);
  }

  const rows = parseFinaiTable(html);
  if (!rows.length) throw new Error('هیچ سطر بانکی در جدول FinAI پیدا نشد');

  const observedAt = observedISO ? String(observedISO).slice(0, 10) : today();
  const { products, corroboration } = mapToProducts(rows, { existing, banks, observedAt });
  const agree = corroboration.filter((c) => c.agree).length;
  log(
    `FinAI: ${rows.length} سطر بانکی → ${products.length} محصول جدید، ${corroboration.length} تطبیق با منابع موجود (${agree} توافق، ${corroboration.length - agree} اختلاف) (${via})`,
  );

  return {
    source: 'finai',
    url,
    via,
    observedAt,
    observedISO,
    chain,
    products,
    corroboration,
    rows: rows.length,
  };
}

/**
 * منبع: مجله دیجی‌شهر — جدول مقایسه نرخ‌های سود سپرده بانک‌ها.
 *
 * صفحه «بهترین بانک‌ها برای سپرده‌گذاری» دو جدول کامل دارد:
 *   ۱. سپرده‌های طرح‌دار فعال (نام طرح، نرخ، مدت، حداقل مبلغ، شرایط برداشت)
 *   ۲. نرخ‌های ترجیحی/کلان — «سقف نرخ سود» پلکانی بر حسب مانده به تفکیک بانک
 *
 * نکته ساختاری مهم: در جدول نرخ‌های ترجیحی، ترتیب ستون‌های «حداقل مدت» و
 * «حداقل موجودی» بین گروه بانک‌ها ناهمگون است (صفحه چند جدول را به هم دوخته
 * است). پارسر به‌جای اتکا به ترتیب ستون، محتوای هر سلول را می‌شناسد: «ماه/سال»
 * یعنی مدت، «تومان/میلیارد/میلیون/هزار» یعنی مبلغ، «٪/درصد/توافقی» یعنی نرخ.
 * سطرهای ادامه‌دار (rowspan بانک) هم باز می‌شوند.
 *
 * سیاست نگاشت:
 *   - نرخ‌های ترجیحی → یک محصول «preferential» برای هر بانک با نردبان پله‌ها در
 *     requirements و بالاترین سقف به‌عنوان rate (همان قرارداد رکوردهای موجود).
 *     اگر برای آن بانک رکورد ترجیحی موجود باشد، همان (id و نامش) به‌روز می‌شود.
 *   - طرح‌های ویژه → محصول مستقل با شناسه پایدار.
 *   - نرخ‌های مصوب سراسری (فهرست تیر) وارد نمی‌شوند: با indicators.json هم‌خوان
 *     نیستند (یک‌ساله ۲۰٫۵٪ در برابر ۲۳٪ ثبت‌شده) و بانک‌محور هم نیستند.
 */

import fs from 'node:fs/promises';
import { get } from '../lib/http.mjs';
import {
  normalizeText,
  foldForMatch,
  today,
  matchBank,
  makeLatinId,
} from '../lib/parse.mjs';
import { benefitFromRate } from './rade.mjs';

export const DGSHAHR_URL = 'https://dgshahr.com/blog/best-banks-for-deposit-rates/';
export const DGSHAHR_TITLE = 'دیجی‌شهر — مقایسه نرخ سود سپرده بانکی ۱۴۰۵';
/** تاریخ آخرین به‌روزرسانی صفحه (مشاهده‌شده در اوت ۲۰۲۶) */
export const DGSHAHR_UPDATED = '2026-08-23';

/* ------------------------------------------------------------------ */
/* ابزارهای متن و عدد                                                   */
/* ------------------------------------------------------------------ */

/** تبدیل ارقام لاتین به فارسی برای فیلدهای نمایشی (قرارداد بقیه داده‌ها) */
export function faDigits(input) {
  return String(input ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

const WORD_NUMS = {
  یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5,
  شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
};

/** حذف تگ‌ها و فشرده‌سازی فاصله؛ ارقام فارسی حفظ می‌شوند (برای برچسب‌های نمایشی) */
export function cellText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numTokens(text) {
  const t = normalizeText(text).replace(/,/g, '');
  const out = [];
  const re = /(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * تجزیه بند مبلغی فارسی به حداقل/حداکثر (تومان).
 * «۵۰ تا ۱۰۰ میلیون تومان» → {min: 5e7, max: 1e8}
 * «یک میلیارد تومان و بیش‌تر» → {min: 1e9, max: null}
 * «کم‌تر از ۵ میلیارد تومان» → {min: null, max: 5e9}
 * «۲-۵ میلیارد تومان» → {min: 2e9, max: 5e9}
 */
export function parseBandAmount(text) {
  const raw = String(text || '');
  const t = normalizeText(raw).replace(/,/g, '');
  if (!t || t === '–' || t === '-') return { min: null, max: null };

  // هر عدد با واحد خودش؛ اگر واحد نداشت، از عددِ دارای واحد بعدی به ارث می‌برد
  // («۵۰ تا ۱۰۰ میلیون» → هر دو بر مبنای میلیون).
  const toks = [];
  const re = /(\d+(?:\.\d+)?|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)\s*(تریلیون|میلیارد|میلیون|هزار)?/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = WORD_NUMS[m[1]] ?? Number.parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    toks.push({ n, unit: m[2] || null });
  }
  if (!toks.length) return { min: null, max: null };

  let carry = null;
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i].unit) carry = toks[i].unit;
    else if (carry) toks[i].unit = carry;
  }
  const multOf = (u) =>
    u === 'تریلیون' ? 1e12 : u === 'میلیارد' ? 1e9 : u === 'میلیون' ? 1e6 : u === 'هزار' ? 1e3 : 1;
  const values = toks.map((x) => Math.round(x.n * multOf(x.unit)));

  if (/کم/.test(t) && /از/.test(t)) return { min: null, max: Math.max(...values) };
  if (/بیش/.test(t)) return { min: Math.min(...values), max: null };
  if (values.length >= 2) return { min: Math.min(...values), max: Math.max(...values) };
  return { min: values[0], max: null };
}

/** تجزیه سلول نرخ: همه اعداد نرخی؛ سقف = بزرگ‌ترین (قرارداد «تا X» داده‌ها) */
export function parseRateCell(text) {
  const nums = numTokens(text).filter((n) => n >= 0 && n <= 100);
  if (!nums.length) return { rate: null, floor: null };
  return { rate: Math.max(...nums), floor: Math.min(...nums) };
}

/** «یک ساله» → 12 ، «۲ ساله» → 24 ، «۳ ماه» → 3 ، «۴ الی ۱۰ سال» → 48 (کف بازه) */
export function parseTermMonths(text) {
  const t = normalizeText(text);
  // بازه «X الی/تا Y» → کف بازه (تعهد کوتاه‌تر) مبنا است
  const m = t.match(
    /(\d+(?:\.\d+)?|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)(?:\s*(?:الی|تا|-)\s*(?:\d+(?:\.\d+)?|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده))?\s*(ماه|سال)/,
  );
  if (!m) return null;
  const n = WORD_NUMS[m[1]] ?? Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] === 'سال' ? n * 12 : n);
}

/** مبلغ نمایشی با واحد فارسی: 5e8 → «۵۰۰ میلیون» */
export function faTomanUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'نامشخص';
  const fmt = (x) => faDigits(String(Math.round(x * 10) / 10));
  if (n >= 1e12) return `${fmt(n / 1e12)} تریلیون`;
  if (n >= 1e9) return `${fmt(n / 1e9)} میلیارد`;
  if (n >= 1e6) return `${fmt(n / 1e6)} میلیون`;
  if (n >= 1e3) return `${fmt(n / 1e3)} هزار`;
  return faDigits(String(n));
}

/* ------------------------------------------------------------------ */
/* تجزیه جدول‌های صفحه                                                 */
/* ------------------------------------------------------------------ */

function extractTableGrids(html) {
  const grids = [];
  for (const tm of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rawRows = [];
    for (const rm of tm[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [];
      for (const cm of rm[0].matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        const rowspan = Number(/rowspan="(\d+)"/i.exec(cm[2])?.[1] ?? 1);
        cells.push({ text: cellText(cm[3]), rowspan: Number.isFinite(rowspan) ? rowspan : 1 });
      }
      if (cells.length) rawRows.push(cells);
    }
    if (rawRows.length >= 2) grids.push(expandRowspans(rawRows));
  }
  return grids;
}

/** باز کردن rowspan: هر سطر در جای ستونی واقعی خود می‌نشیند */
function expandRowspans(rawRows) {
  const grid = [];
  const carry = [];
  for (const cells of rawRows) {
    const line = [];
    let i = 0;
    let col = 0;
    while (i < cells.length || carry[col]) {
      if (carry[col]) {
        line.push(carry[col].text);
        carry[col].remaining -= 1;
        if (carry[col].remaining <= 0) carry[col] = null;
        col += 1;
        continue;
      }
      const c = cells[i++];
      line.push(c.text);
      if (c.rowspan > 1) carry[col] = { text: c.text, remaining: c.rowspan - 1 };
      col += 1;
    }
    grid.push(line);
  }
  return grid;
}

const isBankCell = (s) => /بانک|مؤسسه|موسسه|قرض/.test(s || '');

/**
 * طبقه‌بندی سلول‌های جدول نرخ ترجیحی بر پایه محتوا (نه جای ستون).
 * ترتیب اولویت: ماه/سال (حتی با ٪) ← مبلغ ← نرخ ← سایر (نرخ شکست)
 */
function classifyTierCells(cells) {
  const slots = { bank: null, rate: null, term: null, amount: null, brk: null };
  for (const s of cells) {
    const t = s || '';
    if (!t) continue;
    if (isBankCell(t) && slots.bank == null) {
      slots.bank = t;
      continue;
    }
    if (t === '–' || t === '-') {
      if (slots.brk == null) slots.brk = t;
      continue;
    }
    if (/ماه|سال/.test(t)) {
      if (slots.term == null) slots.term = t;
      else if (slots.brk == null) slots.brk = t;
      continue;
    }
    if (/تومان|میلیارد|میلیون|هزار/.test(t)) {
      if (slots.amount == null) slots.amount = t;
      else if (slots.brk == null) slots.brk = t;
      continue;
    }
    if (/٪|%|درصد|توافقی/.test(t)) {
      if (slots.rate == null) slots.rate = t;
      else if (slots.brk == null) slots.brk = t;
      continue;
    }
    if (slots.brk == null) slots.brk = t;
  }
  return slots;
}

/** جدول ۲ (نرخ‌های ترجیحی) را می‌شناسد و سطرها را برمی‌گرداند */
function parseTierTable(grid) {
  const rows = [];
  for (const line of grid.slice(1)) {
    const s = classifyTierCells(line);
    if (!s.bank || !s.rate) continue;
    const { rate, floor } = parseRateCell(s.rate);
    if (rate == null) continue;
    const band = parseBandAmount(s.amount || '');
    rows.push({
      bank: s.bank,
      rateText: s.rate,
      rate,
      floor,
      termText: s.term || '',
      amountText: s.amount || '',
      minAmount: band.min,
      maxAmount: band.max,
      breakText: s.brk && s.brk !== '–' && s.brk !== '-' ? s.brk : '',
    });
  }
  return rows;
}

/** جدول ۱ (طرح‌های ویژه) — نگاشت موقعیتی با بانک ارث‌بری‌شده از rowspan */
function parseSchemeTable(grid) {
  const rows = [];
  for (const line of grid.slice(1)) {
    // ستون‌ها: بانک | نوع سپرده | نرخ | مدت | حداقل مبلغ | برداشت | مزایا
    const cells = [...line];
    while (cells.length < 7) cells.push('');
    const [c0, c1, c2, c3, c4, c5, c6] = cells;
    const carryBank = rows.length ? rows[rows.length - 1].bank : '';
    let bank;
    let name;
    let rateT;
    let termT;
    let minT;
    let drawT;
    let perkT;
    if (isBankCell(c0)) {
      [bank, name, rateT, termT, minT, drawT, perkT] = [c0, c1, c2, c3, c4, c5, c6];
    } else if (!c0) {
      // سلول بانک خالی (پس از rowspan) — بانک از سطرهای قبلی
      [bank, name, rateT, termT, minT, drawT, perkT] = [carryBank, c1, c2, c3, c4, c5, c6];
    } else {
      // نام طرح در ستون اول نشسته و بانک ارث‌بری می‌شود
      [bank, name, rateT, termT, minT, drawT, perkT] = [carryBank, c0, c1, c2, c3, c4, c5];
    }
    if (!name || !bank) continue;
    const { rate, floor } = parseRateCell(rateT);
    const band = parseBandAmount(minT);
    rows.push({
      bank,
      name,
      rateText: rateT,
      rate,
      floor,
      termText: termT,
      termMonths: parseTermMonths(termT),
      minText: minT,
      minAmount: band.min,
      maxAmount: band.max,
      withdrawal: drawT,
      perks: perkT,
    });
  }
  return rows;
}

/** فهرست نرخ‌های مصوب سراسری (فقط گزارشی؛ وارد محصولات نمی‌شود) */
export function parseStandardRates(html) {
  // ارقام صفحه فارسی‌اند؛ برای تطبیق الگو، اول نرمال می‌شوند
  const text = normalizeText(cellText(String(html).replace(/<[^>]+>/g, ' ')));
  const out = [];
  const re = /نرخ سود سپرده ([^:]{3,40}): (\d+(?:\.\d+)?) درصد/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ label: faDigits(m[1].trim()), rate: Number.parseFloat(m[2]) });
  }
  return out;
}

/** خروجی: سطرهای خام دو جدول + نرخ‌های مصوب */
export function parseDgshahrHtml(html) {
  const grids = extractTableGrids(html);
  const tierRows = [];
  const schemeRows = [];
  for (const g of grids) {
    const header = (g[0] || []).join(' ');
    if (/سقف نرخ/.test(header)) tierRows.push(...parseTierTable(g));
    else if (/نوع سپرده/.test(header)) schemeRows.push(...parseSchemeTable(g));
  }
  return { tierRows, schemeRows, standard: parseStandardRates(html) };
}

/* ------------------------------------------------------------------ */
/* نگاشت به محصولات                                                     */
/* ------------------------------------------------------------------ */

/** پسوند شناسه پایدار طرح‌های شناخته‌شده؛ ناشناخته‌ها makeLatinId می‌گیرند */
const SCHEME_SUFFIXES = new Map(
  Object.entries({
    'سپرده آتیه طلایی ۳': 'atiyeh-talayi-3',
    'طرح سهیم یک': 'saheem-1',
    'طرح سهیم ۲': 'saheem-2',
    'سپرده ویژه': 'vijehe',
    'طرح سرمایه‌گذاری رویش ویپاد': 'rooyesh',
    'طرح سرمایه‌گذاری رستا ویپاد': 'rasta',
    'طرح سرمایه‌گذاری بیست + ویپاد': 'bist-plus',
    'سپرده سرمایه‌گذاری دانش‌آموزی': 'danesh-amoozi',
    'سپرده رفاه فردا': 'farda',
    'سپرده آتیه پلاس': 'atiyeh-plus',
    'سپرده وین کارت': 'win-card',
    'سپرده آتیه طلایی': 'atiyeh-talayi',
    'سپرده سبا': 'saba',
  }).map(([k, v]) => [foldForMatch(k), v]),
);

const sourceRef = () => ({
  kind: 'press',
  title: DGSHAHR_TITLE,
  url: DGSHAHR_URL,
  checked: today(),
});

/**
 * نگاشت سطرهای جدول به رکوردهای استاندارد.
 * @param {{tierRows:object[], schemeRows:object[]}} parsed
 * @param {{existing?:object[], banks?:object[]}} opts
 */
export function mapToProducts(parsed, opts = {}) {
  const { existing = [], banks = [] } = opts;
  const products = [];
  const seenIds = new Set();

  /* --- ۱) نرخ‌های ترجیحی: یک نردبان به‌ازای هر بانک --- */
  const byBank = new Map();
  for (const row of parsed.tierRows ?? []) {
    const key = foldForMatch(row.bank);
    if (!byBank.has(key)) byBank.set(key, { bank: row.bank, tiers: [] });
    byBank.get(key).tiers.push(row);
  }

  for (const { bank: bankRaw, tiers } of byBank.values()) {
    const bank = matchBank(bankRaw, banks);
    // شناسه ترکیبی محصول باید حتماً لاتین بماند؛ matchBank برای نام‌های ناشناخته
    // slugify فارسی برمی‌گرداند که در شناسه محصول مجاز نیست.
    const idBank = /^[a-z0-9][a-z0-9-]*$/.test(bank.id) ? bank.id : makeLatinId('bank', bank.name);
    tiers.sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
    const top = Math.max(...tiers.map((t) => t.rate));
    const floor = Math.min(...tiers.map((t) => t.rate ?? top));
    const mins = tiers.map((t) => t.minAmount).filter((x) => x != null);
    const minAll = mins.length ? Math.min(...mins) : null;

    // به‌روزرسانی رکورد ترجیحی موجود همان بانک (اگر باشد) — نه محصول تکراری
    const prev = existing.find(
      (p) =>
        p.category === 'deposits' &&
        p.subcategory === 'preferential' &&
        (p.bankId === bank.id || foldForMatch(p.bank || '') === foldForMatch(bank.name)),
    );

    const id = prev?.id ?? `${idBank}-deposit-pref-${Math.round(top)}`;
    const rateLabel =
      floor !== top
        ? `ترجیحی ${faDigits(floor)} تا ${faDigits(top)}٪ (سقف نرخ توافقی بر حسب مانده)`
        : `سقف نرخ ترجیحی ${faDigits(top)}٪ (توافقی بر حسب مانده)`;
    const amountLabel =
      tiers.length > 1
        ? `پلکانی برحسب مانده (از ${faTomanUnit(minAll ?? 0)} تومان)`
        : faDigits(tiers[0].amountText);
    const lockups = [...new Set(tiers.map((t) => (t.termText || '').trim()).filter((t) => t && !/^یک ماه/.test(t)))];
    const breakNotes = [...new Set(tiers.map((t) => t.breakText).filter(Boolean))];
    const requirements = [
      ...tiers.map((t) => `${faDigits(t.amountText)}: ${faDigits(t.rateText)}`),
      ...(lockups.length ? [`حداقل مدت برای سقف سود: ${lockups.map(faDigits).join(' / ')}`] : []),
      ...(breakNotes.length ? [`نرخ شکست: ${breakNotes.map(faDigits).join(' / ')}`] : []),
    ];
    const desc = `نرخ‌های ترجیحی ${bank.name} (فراتر از سقف مصوب) بر پایه جدول مقایسه‌ای دیجی‌شهر: پلکانی برحسب مانده${floor !== top ? ` از ${faDigits(floor)} تا ${faDigits(top)}` : ` تا ${faDigits(top)}`} درصد. حساب‌های این جدول از نوع بلندمدت یک‌ساله‌اند و سقف نرخ‌ها توافقی است؛ پیش از افتتاح، شرایط و نرخ قطعی را از شعبه به‌صورت کتبی بگیرید.`;
    // نامِ رکورد به‌روز می‌شود تا نرخ کهنه در نام نماند؛ برچسب طرح‌های خاص
    // (مثل «طرح الماس») از رکورد قبلی حفظ می‌شود.
    const keptTags = (prev?.tags ?? []).filter((t) => /طرح|الماس|ویژه/.test(String(t)) && !/ترجیحی|لایه/.test(String(t)));

    products.push({
      id,
      bank: bank.name,
      bankId: bank.id,
      product:
        floor !== top
          ? `سپرده با سود ترجیحی ${bank.name} (پلکانی ${faDigits(floor)} تا ${faDigits(top)}٪ بر اساس مانده)`
          : `سپرده با سود ترجیحی ${bank.name} (سقف ${faDigits(top)}٪ برای مبالغ بالا)`,
      category: 'deposits',
      subcategory: 'preferential',
      rate: top,
      rateKind: 'profit',
      rateLabel,
      benefit: benefitFromRate(top, 'deposits'),
      minAmount: minAll,
      maxAmount: null,
      amountLabel,
      termMonths: 12,
      termLabel: lockups.length ? `یک‌ساله — حداقل ${lockups.map(faDigits).join(' / ')} برای سقف سود` : 'یک‌ساله',
      speed: 60,
      digital: 70,
      friction: 80,
      collateral: 'ندارد',
      collateralKind: 'none',
      audience: `سپرده‌گذاران با مانده ${faTomanUnit(minAll ?? 0)} تومان به بالا`,
      desc,
      tags: [...new Set(['سود ترجیحی', 'لایه‌بندی مبلغی', bank.name, ...keptTags])],
      requirements,
      confidence: 'medium',
      autoDiscovered: true,
      lastUpdated: DGSHAHR_UPDATED,
      lastSeen: today(),
      lastVerified: today(),
      source: sourceRef(),
    });
    seenIds.add(id);
  }

  /* --- ۲) طرح‌های ویژه: هر طرح یک محصول مستقل --- */
  for (const row of parsed.schemeRows ?? []) {
    const bank = matchBank(row.bank, banks);
    const idBank = /^[a-z0-9][a-z0-9-]*$/.test(bank.id) ? bank.id : makeLatinId('bank', bank.name);
    // کلید نگاشت شناسه: بخش نام بدون پرانتز توضیحی
    const nameHead = row.name.replace(/\s*[(].*$/, '').trim();
    const nameKey = foldForMatch(nameHead);
    const mapped = SCHEME_SUFFIXES.get(nameKey);
    // شناسه باید تماماً لاتین و پایدار بماند؛ ناشناخته‌ها اثر انگشت می‌گیرند
    let id = mapped ? `${idBank}-${mapped}` : makeLatinId(idBank, nameHead);
    // برخورد شناسه در همین اجرا → اثر انگشت پایدار؛ برخورد با رکورد موجود
    // یعنی همان رکورد باید به‌روز شود (ادغام byId) و شناسه باید بماند.
    if (seenIds.has(id)) {
      id = `${idBank}-${makeLatinId('sch', nameHead)}`.replace(/[^a-z0-9-]/g, '').slice(0, 60);
    }

    const capStyle = /سقف/.test(row.rateText);
    const rateLabel = capStyle
      ? faDigits(row.rateText).replace(/^٪/, '')
      : faDigits(row.rateText);
    const subcategory = /سبا|وین|جاری|قرعه/.test(row.name) ? 'current' : 'premium';
    const requirements = [
      row.minText && faDigits(row.minText) !== '–' ? `حداقل مبلغ: ${faDigits(row.minText)}` : null,
      row.withdrawal && row.withdrawal !== '–' ? `برداشت پیش از موعد: ${faDigits(row.withdrawal)}` : null,
      row.perks && row.perks !== '–' ? `مزایا: ${faDigits(row.perks)}` : null,
    ].filter(Boolean);

    products.push({
      id,
      bank: bank.name,
      bankId: bank.id,
      product: faDigits(row.name),
      category: 'deposits',
      subcategory,
      rate: row.rate ?? 0,
      rateKind: 'profit',
      rateLabel,
      benefit: benefitFromRate(row.rate, 'deposits'),
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      amountLabel: row.minText ? faDigits(row.minText) : 'نامشخص',
      termMonths: row.termMonths,
      termLabel: row.termText && row.termText !== '–' ? faDigits(row.termText) : 'بدون سررسید ثبت‌شده',
      speed: 65,
      digital: /آنلاین|الکترونیکی|موبایل/.test(`${row.withdrawal} ${row.perks}`) ? 85 : 65,
      friction: 80,
      collateral: 'ندارد',
      collateralKind: 'none',
      audience: subcategory === 'current' ? 'مدیریت نقدینگی روزمره' : 'سپرده‌گذاران متقاضی طرح‌های ویژه',
      desc: `${faDigits(row.name)} — ${bank.name}. ${faDigits(row.rateText)}${row.termText && row.termText !== '–' ? `؛ مدت ${faDigits(row.termText)}` : ''}${row.withdrawal && row.withdrawal !== '–' ? `؛ برداشت پیش از موعد: ${faDigits(row.withdrawal)}` : ''}. نرخ‌ها و شرایط طبق جدول مقایسه‌ای دیجی‌شهر و قابل تغییر توسط بانک است.`.slice(0, 700),
      tags: ['طرح ویژه سپرده‌گذاری', bank.name],
      requirements,
      confidence: 'medium',
      autoDiscovered: true,
      lastUpdated: DGSHAHR_UPDATED,
      lastSeen: today(),
      lastVerified: today(),
      source: sourceRef(),
    });
    seenIds.add(id);
  }

  return products;
}

/* ------------------------------------------------------------------ */
/* جمع‌آوری                                                             */
/* ------------------------------------------------------------------ */

/**
 * واکشی و نگاشت صفحه دیجی‌شهر.
 * html تزریقی (تست/واردسازی آفلاین) یا DGSHAHR_HTML_FILE بر قرارداد مقدم است.
 * @param {{html?:string, url?:string, existing?:object[], banks?:object[], log?:Function}} opts
 */
export async function collect(opts = {}) {
  const { url = DGSHAHR_URL, html: injected, existing = [], banks = [], log = () => {} } = opts;

  let html = injected ?? null;
  if (!html && process.env.DGSHAHR_HTML_FILE) {
    html = await fs.readFile(process.env.DGSHAHR_HTML_FILE, 'utf8');
  }
  if (!html) {
    html = await get(url, { timeout: 30_000, retries: 2 });
  }

  const parsed = parseDgshahrHtml(html);
  if (!parsed.tierRows.length && !parsed.schemeRows.length) {
    throw new Error('هیچ جدول نرخی در صفحه دیجی‌شهر پیدا نشد');
  }

  const products = mapToProducts(parsed, { existing, banks });
  log(
    `دیجی‌شهر: ${byCount(parsed.tierRows)} پله نرخ ترجیحی و ${parsed.schemeRows.length} طرح ویژه → ${byCount(products)} محصول`,
  );

  return {
    source: 'dgshahr',
    url,
    products,
    tierRows: parsed.tierRows.length,
    schemeRows: parsed.schemeRows.length,
    standard: parsed.standard,
  };
}

function byCount(list) {
  return Array.isArray(list) ? list.length : String(list ?? '');
}

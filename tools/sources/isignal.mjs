/**
 * منبع: آی‌سیگنال (isignal.ir) — فهرست و کارنامهٔ صندوق‌های درآمد ثابت.
 *
 * چرا این منبع؟ صفحهٔ https://isignal.ir/fund/ بازدهی هفتگی/ماهانه/سه‌ماهه/
 * شش‌ماهه/یک‌ساله، قیمت صدور و ابطال، مدیر، ضامن نقدشوندگی و تاریخ آغاز
 * فعالیت همهٔ صندوق‌های بورسی را از فیپیران تجمیع می‌کند؛ یعنی یک «سنجهٔ
 * یکسان» (بازدهی محقق‌شدهٔ یک‌ساله) برای مقایسهٔ منصفانهٔ صندوق‌های ETF و
 * صدور/ابطالی در کنار سپرده‌های بانکی به دست می‌دهد.
 *
 * دو مسیر ورودی:
 *   ۱) برخط: جدول آی‌سیگنال سمت کاربر رندر می‌شود و داده‌اش را از
 *      `advancedchart.isignal.ir/service/signalData@4.0.0/list` (POST) می‌گیرد.
 *      همان درخواست را با همان بدنهٔ اسکریپت سایت می‌فرستیم و فقط نوع‌های
 *      «درآمد ثابت» (typeId 30 = صدور و ابطالی، 43 = ETF) را نگه می‌داریم.
 *   ۲) برون‌خط: `ISIGNAL_JSON_FILE=…` یا `snapshot` — برش JSON از صفحهٔ
 *      مقایسهٔ آی‌سیگنال (tests/fixtures/isignal-funds-*.json) که در محیط‌های
 *      بدون دسترسی شبکه (CI محدود، سندباکس) همان نگاشت را تولید می‌کند.
 *
 * اصل طراحی: این ماژول «چیزی حدس نمی‌زند». هرچه در ردیف نیست (سایت، ضامن،
 * NAV) در توضیحات حذف می‌شود؛ رکوردهای دست‌نویس (curated) فقط نرخ/برچسب/
 * فراداده می‌گیرند و متن و منبع رسمی‌شان دست‌نخورده می‌ماند (mergeProducts).
 */

import fs from 'node:fs/promises';
import { get } from '../lib/http.mjs';
import { normalizeText, foldForMatch, toNumber, today, matchBank, makeLatinId } from '../lib/parse.mjs';
import { jalaliToGregorian } from '../lib/jalali.mjs';

export const ISIGNAL_FUND_LIST_URL = 'https://isignal.ir/fund/';
export const ISIGNAL_API_BASE = 'https://advancedchart.isignal.ir/service/signalData@4.0.0';
export const ISIGNAL_SOURCE_NAME = 'isignal.ir';

/** نوع‌های صندوق در آی‌سیگنال که «درآمد ثابت» به شمار می‌آیند */
export const FIXED_INCOME_TYPES = Object.freeze({
  30: 'issuance-redemption',
  43: 'etf',
});

/** بازهٔ معقول بازدهی یک‌سالهٔ صندوق درآمد ثابت؛ خارج از آن = دادهٔ ناقص/نوپا */
export const SANE_RETURN_RANGE = Object.freeze({ min: 5, max: 70 });

/** بدنهٔ درخواست فهرست — عیناً همان چیزی که اسکریپت fund-list سایت می‌فرستد */
export const LIST_PAYLOAD = Object.freeze({
  market: 'fund',
  sortBy: { key: 'return.oneYear', order: 'desc' },
  selectProperties: {
    properties: [
      'id',
      'name',
      'date',
      'return.oneYear',
      'return.sixMonth',
      'return.threeMonth',
      'return.oneMonth',
      'return.oneWeek',
      'buyPrice',
      'sellPrice',
      'manager',
      'rasamUrl',
      'typeId',
    ],
  },
});

/* ------------------------------------------------------------------ */
/* جدول شناخت صندوق‌ها                                                  */
/* ------------------------------------------------------------------ */

/**
 * نگاشت شناسهٔ آی‌سیگنال → هویت پایدار در بانک‌رادار.
 *
 * - `slug`: دنبالهٔ لاتین شناسهٔ محصول (`fund-<slug>`)؛ ثابت می‌ماند تا
 *   تاریخچهٔ تغییرات (changelog) و نشانک کاربران نشکند.
 * - `existingId`: رکورد دست‌نویسی که همین صندوق را پوشش می‌دهد؛ برای این‌ها
 *   فقط «به‌روزرسانی سبک» می‌فرستیم.
 * - `bankId`: نهاد در data/banks.json (بانکِ ضامن/گروه، یا خودِ مدیر صندوق).
 * - `fullName`: نام کامل ثبت‌شده وقتی نماد کوتاه است (فقط موارد قطعی).
 * - `payout`: 'monthly' = تقسیم سود دوره‌ای (بر اساس فهرست آی‌سیگنال)،
 *   'none' = سود در NAV انباشته می‌شود.
 */
export const KNOWN_FUNDS = Object.freeze({
  // ---- ETF ----
  324: { slug: 'etemad-parsian', bankId: 'parsian', fullName: 'اعتماد آفرین پارسیان', payout: 'none' },
  567: { slug: 'kamand-charisma', bankId: 'charisma', fullName: 'با درآمد ثابت کمند', payout: 'monthly' },
  553: { slug: 'kian', bankId: 'kian', fullName: 'با درآمد ثابت کیان', payout: 'none' },
  5061: { slug: 'afran-toranj', existingId: 'fund-afran-toranj', bankId: 'toranj', fullName: 'افرا نماد پایدار', payout: 'none' },
  5114: { slug: 'homay-agah', bankId: 'agah', fullName: 'همای آگاه', payout: 'monthly' },
  211: { slug: 'asan-ganjineh-mehr', bankId: 'sepah', fullName: 'مشترک گنجینه مهر', payout: 'monthly' },
  554: { slug: 'amin-yekom-farda', bankId: 'amin-ib', fullName: 'امین یکم فردا', payout: 'monthly' },
  5170: { slug: 'neshan-hummers', bankId: 'hummers', payout: 'none' },
  5208: { slug: 'etebar-etf', bankId: 'etebar', payout: 'none' },
  5271: { slug: 'mahoor-meyar', bankId: 'meyar', payout: 'none' },
  5214: { slug: 'rabin', bankId: 'rabin', payout: 'none' },
  5324: { slug: 'karamad', bankId: 'karamad', payout: 'none' },
  5328: { slug: 'asood-arman-eghtesad', bankId: 'arman-eghtesad', payout: 'none' },
  5123: { slug: 'kara-charisma', existingId: 'fund-kara-charisma', bankId: 'charisma', fullName: 'کارا کاریزما', payout: 'none' },
  5119: { slug: 'sobat-vista', bankId: 'vista', fullName: 'ثبات ویستا', payout: 'none' },
  5076: { slug: 'separ-eghtesad-bidar', bankId: 'eghtesad-bidar', fullName: 'سپر سرمایه بیدار', payout: 'none' },
  5183: { slug: 'labkhand-farabi', existingId: 'fund-labkhand-farabi', bankId: 'farabi', fullName: 'لبخند فارابی', payout: 'none' },
  575: { slug: 'firouza', bankId: 'firouzeh', fullName: 'فیروزه آسیا', payout: 'none' },
  5089: { slug: 'khatam-isatis', bankId: 'isatis', fullName: 'خاتم ایساتیس پویا', payout: 'none' },
  5062: { slug: 'yaghoot-agah', existingId: 'fund-yaghoot-agah', bankId: 'agah', fullName: 'یاقوت آگاه', payout: 'none' },
  5146: { slug: 'hummers-etemad', bankId: 'hummers', fullName: 'اعتماد هامرز', payout: 'monthly' },
  5237: { slug: 'akam-vista', bankId: 'vista', fullName: 'ثابت آکام', payout: 'monthly' },
  225: { slug: 'armaghan-iranian', bankId: 'eghtesad-novin', fullName: 'ارمغان ایرانیان', payout: 'monthly' },
  536: { slug: 'parand-sepehr', bankId: 'saderat', fullName: 'پارند پایدار سپهر', payout: 'monthly' },
  5216: { slug: 'nili-damavand', bankId: 'damavand-ib', fullName: 'نیلی دماوند', payout: 'monthly' },
  5298: { slug: 'hamgam-ashna', bankId: 'ashna', fullName: 'همگام آشنا ایرانیان', payout: 'monthly' },
  5350: { slug: 'andookhteh-dariush', bankId: 'dariush', payout: 'monthly' },
  5111: { slug: 'kamyab-ashna', bankId: 'ashna', fullName: 'کامیاب آشنا', payout: 'none' },
  5117: { slug: 'mani', bankId: 'mani', payout: 'none' },
  5115: { slug: 'sinad-sina', bankId: 'sina-amc', payout: 'none' },
  559: { slug: 'ganjin-avid', bankId: 'amin-ib', fullName: 'گنجینه یکم آوید', payout: 'none' },
  353: { slug: 'accord-arman-ati', bankId: 'arman-ati', fullName: 'آرمان آتی کوثر', payout: 'none' },
  330: { slug: 'sayand-ayandeh', bankId: 'ayandeh', fullName: 'گنجینه آینده روشن', payout: 'none' },
  332: { slug: 'sokhand-khobregan', bankId: 'nikan-afagh', fullName: 'سپهر خبرگان نفت', payout: 'monthly' },
  333: { slug: 'sepas-tamadon', bankId: 'tamadon-ib', payout: 'none' },
  5104: { slug: 'sepidma-damavand', bankId: 'damavand-ib', fullName: 'سپید دماوند', payout: 'none' },
  5141: { slug: 'yara-aria', bankId: 'aria', payout: 'none' },
  5313: { slug: 'etminan-hiwa', bankId: 'hiwa', payout: 'none' },
  // ---- صدور و ابطالی ----
  5247: { slug: 'sobat-navid', bankId: 'navid', payout: 'none' },
  5138: { slug: 'aseman-sahand', bankId: 'aseman', payout: 'monthly' },
  5217: { slug: 'rasa-algorithm', bankId: 'algorithm', payout: 'monthly' },
  302: { slug: 'hami-1-mofid', bankId: 'mofid', payout: 'none' },
  978: { slug: 'hami-2-mofid', bankId: 'mofid', payout: 'none' },
  323: { slug: 'kardan-tejarat', bankId: 'tejarat', payout: 'monthly' },
  230: { slug: 'ganjineh-zarrin-shahr', existingId: 'fund-ganjineh-zarrin-shahr', bankId: 'shahr', payout: 'monthly' },
  269: { slug: 'lotus-parsian', existingId: 'fund-lotus-parsian', bankId: 'parsian', payout: 'monthly' },
  228: { slug: 'amin-ashna', existingId: 'fund-amin-ashna', bankId: 'ashna', payout: 'monthly' },
  238: { slug: 'hekmat-ashna', bankId: 'ashna', payout: 'monthly' },
  5077: { slug: 'etebar-afarin', bankId: 'etebar', payout: 'monthly' },
  539: { slug: 'golbarg-arman-ati', bankId: 'arman-ati', payout: 'monthly' },
  5043: { slug: 'noafarin-fintech', bankId: 'fintech-noafarin', payout: 'monthly' },
  341: { slug: 'kosar-1-aban', bankId: 'aban', payout: 'monthly' },
  5331: { slug: 'rooyesh-sina', bankId: 'sina-amc', payout: 'monthly' },
  327: { slug: 'ofogh-middle-east', bankId: 'middle-east', payout: 'monthly' },
  5277: { slug: 'ravand-aban', bankId: 'aban', payout: 'monthly' },
  191: { slug: 'amin-ansar', bankId: 'amin-ib', payout: 'monthly' },
  313: { slug: 'charisma-fixed', bankId: 'charisma', payout: 'monthly' },
  545: { slug: 'etemad-melal', bankId: 'mellal', payout: 'monthly' },
  5118: { slug: 'ettehad-arman-eghtesad', bankId: 'arman-eghtesad', payout: 'monthly' },
  234: { slug: 'gardeshgari', bankId: 'gardeshgari', payout: 'monthly' },
  296: { slug: 'iran-zamin', bankId: 'iran-zamin', payout: 'monthly' },
  280: { slug: 'keshavarzi-1', bankId: 'keshavarzi', payout: 'monthly' },
  343: { slug: 'tosee-taavon-saba', bankId: 'tosee-taavon', payout: 'monthly' },
  345: { slug: 'omid-ansar', bankId: 'sepah', payout: 'monthly' },
  328: { slug: 'omid-sepah', existingId: 'fund-omid-sepah', bankId: 'sepah', payout: 'monthly' },
  569: { slug: 'etemad-melli', bankId: 'melli', payout: 'monthly' },
  255: { slug: 'andookhteh-sepehr', bankId: 'saderat', payout: 'monthly' },
});

/* ------------------------------------------------------------------ */
/* ابزارهای کوچک قالب‌بندی                                             */
/* ------------------------------------------------------------------ */

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = (input) => String(input ?? '').replace(/\d/g, (d) => FA[Number(d)]);

/** گرد کردن به ۲ رقم اعشار بدون خطای ممیز شناور */
export const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** «۱۳.۷ هزار تومان» — عدد به تومان */
export function faToman(toman) {
  const n = Number(toman);
  if (!Number.isFinite(n) || n <= 0) return null;
  const fmt = (x) => faDigits(String(Math.round(x * 10) / 10));
  if (n >= 1e9) return `${fmt(n / 1e9)} میلیارد تومان`;
  if (n >= 1e6) return `${fmt(n / 1e6)} میلیون تومان`;
  if (n >= 1e3) return `${fmt(n / 1e3)} هزار تومان`;
  return `${faDigits(String(Math.round(n)))} تومان`;
}

/** NAV به میلیارد ریال → «۱۲۹.۷ هزار میلیارد تومان» / «۷۵.۵ میلیارد تومان» */
export function faNavToman(navBillionRial) {
  const n = Number(navBillionRial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const billionToman = n / 10;
  const fmt = (x) => faDigits(String(Math.round(x * 10) / 10));
  if (billionToman >= 1000) return `${fmt(billionToman / 1000)} هزار میلیارد تومان`;
  return `${fmt(billionToman)} میلیارد تومان`;
}

/** «1405/07/05» → «۱۴۰۵/۰۷/۰۵» */
export const faJalali = (text) => (text ? faDigits(String(text)) : null);

/** نام مدیر با املای یکدست («سبد گردان» → «سبدگردان»، «تامین» → «تأمین») */
export function tidyManager(name) {
  return normalizeText(name)
    .replace(/سبد\s+گردان/g, 'سبدگردان')
    .replace(/تامین سرمایه/g, 'تأمین سرمایه')
    .replace(/سرمایه گذاری/g, 'سرمایه‌گذاری')
    .replace(/\s*\(فاینتک\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** نام کوتاه صندوق بدون عبارت‌های قالبی («در اوراق بهادار با درآمد ثابت …») */
export function shortFundName(name) {
  return normalizeText(name)
    .replace(/^صندوق\s+(سرمایه[\u200c ]?گذاری\s+)?/, '')
    .replace(/^در اوراق بهادار با درآمد ثابت\s+/, '')
    .replace(/^با درآمد ثابت\s+/, '')
    .replace(/^ثابت\s+/, '')
    .trim();
}

/** نشانی صفحهٔ صندوق در آی‌سیگنال: /fund/<عنوان با خط تیره>/ */
export function fundPageUrl(name) {
  const slug = normalizeText(name).replace(/\s+/g, '-');
  return `${ISIGNAL_FUND_LIST_URL}${encodeURIComponent(slug)}/`;
}

/**
 * تبدیل تاریخ ردیف به ISO میلادی.
 * ورودی‌های پذیرفته: «1405/07/05»، «۱۴۰۵/۰۷/۰۵»، «1405-07-05»، «2026-09-27» (ISO).
 */
export function rowDateToIso(value) {
  if (!value) return null;
  const t = normalizeText(value);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso && Number(iso[1]) >= 1900) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const j = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!j) return null;
  const jy = Number(j[1]);
  const jm = Number(j[2]);
  const jd = Number(j[3]);
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/** تاریخ شمسی به شکل «1405/07/05» (ورودی ممکن است با ارقام فارسی یا خط تیره باشد) */
export function canonicalJalali(value) {
  if (!value) return null;
  const j = normalizeText(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!j) return null;
  return `${j[1]}/${j[2].padStart(2, '0')}/${j[3].padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* نرمال‌سازی ردیف‌ها                                                 */
/* ------------------------------------------------------------------ */

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return toNumber(v);
};

/**
 * یک ردیف خام (API یا برش) → شکل یکدست داخلی.
 * @returns {{id:number,name:string,typeId:number|null,etf:boolean,manager:string,oneYear:number|null,
 *   sixMonth:number|null,threeMonth:number|null,oneMonth:number|null,oneWeek:number|null,
 *   issuePrice:number|null,redeemPrice:number|null,navBillionRial:number|null,guarantor:string|null,
 *   site:string|null,started:string|null,date:string|null,rasamUrl:string|null}|null}
 */
export function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = num(pick(raw, 'id', 'symbolId', 'isignalId'));
  const name = normalizeText(pick(raw, 'name', 'title', 'symbol') || '');
  if (!id || !name) return null;

  const typeId = num(pick(raw, 'typeId', 'type.id'));
  const etf =
    typeof raw.etf === 'boolean'
      ? raw.etf
      : typeId != null
        ? typeId === 43
        : /etf/i.test(String(pick(raw, 'type', 'typeName', 'kind') || ''));

  const guarantorRaw = normalizeText(pick(raw, 'guarantor', 'liquidityGuarantor') || '');
  const guarantor = guarantorRaw && !/^(ندارد|-|—)$/.test(guarantorRaw) ? guarantorRaw : null;

  const siteRaw = normalizeText(pick(raw, 'site', 'website', 'url') || '');
  const site = /^https?:\/\//i.test(siteRaw) ? siteRaw : null;

  return {
    id: Math.trunc(id),
    name,
    typeId: typeId == null ? (etf ? 43 : 30) : Math.trunc(typeId),
    etf,
    manager: tidyManager(pick(raw, 'manager', 'managerName') || ''),
    oneYear: num(pick(raw, 'oneYear', 'return.oneYear', 'annual')),
    sixMonth: num(pick(raw, 'sixMonth', 'return.sixMonth')),
    threeMonth: num(pick(raw, 'threeMonth', 'return.threeMonth')),
    oneMonth: num(pick(raw, 'oneMonth', 'return.oneMonth')),
    oneWeek: num(pick(raw, 'oneWeek', 'return.oneWeek')),
    issuePrice: num(pick(raw, 'issuePrice', 'buyPrice', 'issue')),
    redeemPrice: num(pick(raw, 'redeemPrice', 'sellPrice', 'redeem')),
    navBillionRial: num(pick(raw, 'navBillionRial', 'navB', 'nav')),
    guarantor,
    site,
    started: canonicalJalali(pick(raw, 'started', 'inception', 'startDate')),
    date: canonicalJalali(pick(raw, 'date', 'updated', 'dataDate')) || pick(raw, 'date', 'updated', 'dataDate'),
    rasamUrl: pick(raw, 'rasamUrl') || null,
  };
}

/** آیا ردیف، صندوق درآمد ثابت با دادهٔ معتبر است؟ (خروجی: دلیل حذف یا null) */
export function rejectReason(row) {
  if (!row) return 'ردیف نامعتبر';
  if (!FIXED_INCOME_TYPES[row.typeId]) return `نوع ${row.typeId} درآمد ثابت نیست`;
  if (row.oneYear == null) return 'بازدهی یک‌ساله ندارد';
  if (row.oneYear < SANE_RETURN_RANGE.min || row.oneYear > SANE_RETURN_RANGE.max) {
    return `بازدهی یک‌ساله ${row.oneYear}٪ خارج از بازهٔ معقول (صندوق نوپا/دادهٔ ناقص)`;
  }
  if (!row.manager) return 'مدیر صندوق مشخص نیست';
  return null;
}

/* ------------------------------------------------------------------ */
/* نگاشت به رکورد محصول                                               */
/* ------------------------------------------------------------------ */

/**
 * امتیاز «سود» بر پایهٔ بازدهی یک‌ساله. مقیاس با رکوردهای دست‌نویس صندوق
 * هم‌راستاست (~۲۸٪ → ۷۱، ~۳۶٪ → ۸۳): هر ۱ واحد درصد بازدهی ≈ ۱.۵ امتیاز.
 */
export function fundBenefit(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 55;
  return Math.max(40, Math.min(95, Math.round(70 + (r - 27) * 1.5)));
}

/** نام نهاد از banks.json بر اساس شناسه */
function bankById(banks, id) {
  return (banks || []).find((b) => b.id === id) || null;
}

/** آیا نهاد یک «بانک/مؤسسهٔ اعتباری» است یا خودِ مدیر صندوق؟ */
function isBankEntity(entity) {
  if (!entity) return false;
  const kind = foldForMatch(entity.kind || '');
  return /^(دولتی|خصوصی|تخصصی|مؤسسه اعتباری|موسسه اعتباری)/.test(kind) || /^بانک/.test(entity.name || '');
}

function guessBankId(row, banks) {
  const hit = matchBank(row.manager, banks || []);
  if (hit && /^[a-z0-9][a-z0-9-]*$/.test(hit.id)) return hit.id;
  return makeLatinId('amc', row.manager || String(row.id));
}

/** شناسهٔ نمایشی «بانک / مدیر» به همان الگوی رکوردهای دست‌نویس */
function bankDisplay(entity, row) {
  const manager = row.manager || '';
  if (!entity) return manager;
  if (isBankEntity(entity)) {
    // مدیر خودِ کارگزاری/تأمین سرمایهٔ بانک است یا نهاد جداگانه؛ در هر دو حالت الگو: «بانک / مدیر»
    return manager && foldForMatch(manager) !== foldForMatch(entity.name) ? `${entity.name} / ${manager}` : entity.name;
  }
  return manager || entity.name;
}

function productTitle(row, meta) {
  const short = shortFundName(row.name);
  const full = meta.fullName && foldForMatch(meta.fullName) !== foldForMatch(short) ? meta.fullName : null;
  if (row.etf) {
    return full ? `صندوق درآمد ثابت ${full} (ETF - ${short})` : `صندوق درآمد ثابت ${short} (ETF)`;
  }
  const isFixedPrefixed = /با درآمد ثابت|^ثابت\s/.test(normalizeText(row.name));
  const noun = isFixedPrefixed ? 'صندوق درآمد ثابت' : 'صندوق سرمایه‌گذاری';
  return `${noun} ${short} (صدور و ابطالی)`;
}

function returnsSentence(row) {
  const parts = [];
  if (row.sixMonth != null) parts.push(`شش‌ماهه ${faDigits(round2(row.sixMonth))}٪`);
  if (row.threeMonth != null) parts.push(`سه‌ماهه ${faDigits(round2(row.threeMonth))}٪`);
  if (row.oneMonth != null) parts.push(`یک‌ماهه ${faDigits(round2(row.oneMonth))}٪`);
  return parts.length ? ` (${parts.join('، ')})` : '';
}

function buildDesc(row, meta, payout, unitToman) {
  const short = shortFundName(row.name);
  const kind = row.etf ? 'قابل معامله در بورس (ETF)' : 'صدور و ابطالی';
  const s = [];
  s.push(
    `صندوق درآمد ثابت ${kind} «${meta.fullName || short}»` +
      (row.manager ? ` با مدیریت ${row.manager}` : '') +
      (row.started ? ` از ${faJalali(row.started)} فعال است` : '') +
      (row.navBillionRial ? ` و خالص ارزش دارایی‌های آن حدود ${faNavToman(row.navBillionRial)} است.` : '.'),
  );
  s.push(
    `بازدهی محقق‌شدهٔ یک‌سالهٔ آن طبق داده‌های آی‌سیگنال (به‌روزرسانی ${faJalali(row.date) || 'اخیر'}) ${faDigits(round2(row.oneYear))}٪ بوده است${returnsSentence(row)}.`,
  );
  if (row.etf) {
    s.push(
      payout === 'monthly'
        ? `واحدها با نماد «${short}» در بورس معامله می‌شوند و سود به‌صورت دوره‌ای (ماهانه) تقسیم می‌شود.`
        : `واحدها با نماد «${short}» در بورس معامله می‌شوند و سود در قیمت واحد (NAV) انباشته می‌شود؛ تقسیم سود دوره‌ای ندارد.`,
    );
  } else {
    s.push(
      payout === 'monthly'
        ? 'صدور و ابطال واحدها از طریق مدیر صندوق انجام می‌شود و سود به‌صورت دوره‌ای (ماهانه) به حساب سرمایه‌گذار واریز می‌گردد.'
        : 'صدور و ابطال واحدها از طریق مدیر صندوق انجام می‌شود و سود در قیمت واحد انباشته می‌شود؛ تقسیم سود دوره‌ای ندارد.',
    );
  }
  if (row.guarantor) s.push(`ضامن نقدشوندگی: ${row.guarantor}.`);
  if (unitToman) s.push(`قیمت هر واحد حدود ${faToman(unitToman)} است.`);
  s.push('بازدهی گذشته تضمین‌کنندهٔ بازدهی آینده نیست.');
  return s.join(' ');
}

/** فرادادهٔ ساخت‌یافتهٔ آی‌سیگنال که کنار رکورد ذخیره می‌شود */
export function buildExtra(row, meta, payout) {
  return {
    isignalId: row.id,
    symbol: row.etf ? shortFundName(row.name) : null,
    fullName: meta.fullName || null,
    manager: row.manager || null,
    payout,
    returns: {
      oneWeek: row.oneWeek,
      oneMonth: row.oneMonth,
      threeMonth: row.threeMonth,
      sixMonth: row.sixMonth,
      oneYear: row.oneYear,
    },
    issuePrice: row.issuePrice,
    redeemPrice: row.redeemPrice,
    navBillionRial: row.navBillionRial,
    guarantor: row.guarantor,
    site: row.site,
    inception: row.started,
    dataDate: row.date,
  };
}

/**
 * ردیف نرمال‌شده → رکورد محصول با فرمت data/products.json.
 *
 * @param {ReturnType<typeof normalizeRow>} row
 * @param {{banks?:Array, existing?:Array, today?:string}} [ctx]
 * @returns {object|null} رکورد کامل (صندوق تازه) یا «به‌روزرسانی سبک» (صندوق دست‌نویس)
 */
export function mapFundToProduct(row, ctx = {}) {
  if (rejectReason(row)) return null;
  const meta = KNOWN_FUNDS[row.id] || {};
  const banks = ctx.banks || [];
  const existing = ctx.existing || [];
  const now = ctx.today || today();

  const rate = round2(row.oneYear);
  const dataDateIso = rowDateToIso(row.date) || now;
  const lastUpdated = dataDateIso > now ? now : dataDateIso;
  const payout = meta.payout || 'none';
  const subcategory = row.etf ? 'etf' : 'issuance-redemption';
  const kindLabel = row.etf ? 'ETF بورسی' : 'صدور و ابطالی';
  const payoutLabel = payout === 'monthly' ? 'تقسیم سود ماهانه' : 'سود انباشته در NAV';
  const rateLabel = `بازدهی یک‌ساله ${faDigits(rate)}٪ (${kindLabel}، ${payoutLabel}) — آی‌سیگنال ${faJalali(row.date) || ''}`.trim();
  const extra = buildExtra(row, meta, payout);

  // رکوردهای دست‌نویس: فقط سنجه و فرادادهٔ تازه؛ متن/منبع رسمی محفوظ می‌ماند (mergeProducts)
  const curated = meta.existingId ? existing.find((p) => p.id === meta.existingId && p.autoDiscovered !== true) : null;
  if (curated) {
    return {
      id: curated.id,
      bank: curated.bank,
      product: curated.product,
      category: 'funds',
      rate,
      rateLabel,
      extra: { ...(curated.extra || {}), isignal: extra },
      lastUpdated,
      lastSeen: now,
    };
  }

  const bankId = meta.bankId || guessBankId(row, banks);
  const entity = bankById(banks, bankId);
  const bank = bankDisplay(entity, row);
  const short = shortFundName(row.name);
  const unitRial = row.etf ? row.redeemPrice || row.issuePrice : row.issuePrice || row.redeemPrice;
  const unitToman = unitRial ? Math.round(unitRial / 10) : null;

  const requirements = row.etf
    ? ['کد بورسی (سجام)', 'حساب معاملاتی نزد کارگزاری']
    : ['ثبت‌نام سجام', row.site ? `صدور و ابطال از طریق تارنمای صندوق (${row.site.replace(/^https?:\/\//, '')})` : 'صدور و ابطال از طریق مدیر صندوق'];

  const tags = [
    'صندوق درآمد ثابت',
    row.etf ? 'ETF' : 'صدور و ابطالی',
    short,
    payout === 'monthly' ? 'تقسیم سود ماهانه' : 'بدون تقسیم سود',
    ...(row.guarantor ? ['ضامن نقدشوندگی'] : []),
    ...(rate >= 35 ? ['بازدهی بالا'] : []),
    ...(row.manager ? [row.manager.replace(/^(سبدگردان|تأمین سرمایه|کارگزاری|مشاور سرمایه‌گذاری)\s+/, '')] : []),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i);

  const guarantorNote = row.guarantor ? `ضامن نقدشوندگی: ${row.guarantor}` : null;

  return {
    id: `fund-${meta.slug || `isignal-${row.id}`}`,
    bank,
    bankId,
    product: productTitle(row, meta),
    category: 'funds',
    subcategory,
    rate,
    rateKind: 'profit',
    rateLabel,
    benefit: fundBenefit(rate),
    minAmount: unitToman,
    maxAmount: null,
    amountLabel: unitToman
      ? row.etf
        ? `هر واحد حدود ${faToman(unitToman)} — خرید در سامانهٔ معاملات برخط کارگزاری`
        : `هر واحد حدود ${faToman(unitToman)} — حداقل صدور طبق امیدنامه`
      : 'طبق امیدنامهٔ صندوق',
    termMonths: null,
    termLabel: row.etf
      ? payout === 'monthly'
        ? 'روزشمار — تقسیم سود ماهانه؛ نقدشوندگی در ساعات معاملات بورس'
        : 'روزشمار — سود در NAV انباشته می‌شود؛ نقدشوندگی در ساعات معاملات بورس'
      : payout === 'monthly'
        ? 'روزشمار — واریز سود ماهانه؛ ابطال از طریق مدیر صندوق (چند روز کاری)'
        : 'روزشمار — سود در NAV انباشته می‌شود؛ ابطال از طریق مدیر صندوق (چند روز کاری)',
    speed: row.etf ? 93 : 85,
    digital: row.etf ? 95 : 85,
    friction: row.etf ? 94 : row.guarantor ? 90 : 88,
    collateral: row.etf
      ? 'ندارد — نقدشوندگی از طریق بازار سرمایه'
      : guarantorNote
        ? `ندارد — ${guarantorNote}`
        : 'ندارد — ابطال واحدها از طریق مدیر صندوق',
    collateralKind: 'none',
    audience: row.etf
      ? 'دارندگان کد بورسی که نقدشوندگی روزانه و سود بالاتر از سپرده می‌خواهند'
      : payout === 'monthly'
        ? 'سرمایه‌گذاران کم‌ریسک متقاضی واریز سود ماهانه بدون نیاز به معاملات برخط'
        : 'سرمایه‌گذاران کم‌ریسک با افق چندماهه که به سود انباشته بسنده می‌کنند',
    desc: buildDesc(row, meta, payout, unitToman),
    tags,
    requirements,
    confidence: 'medium',
    regulatory: true,
    autoDiscovered: true,
    lastUpdated,
    lastSeen: now,
    lastVerified: now,
    source: {
      title: `آی‌سیگنال — صندوق ${short}`,
      url: fundPageUrl(row.name),
      kind: 'aggregator',
      checked: now,
    },
    extra,
  };
}

/* ------------------------------------------------------------------ */
/* واکشی / بارگذاری                                                    */
/* ------------------------------------------------------------------ */

/** فهرست صندوق‌ها از API آی‌سیگنال (همان درخواستی که صفحهٔ /fund/ می‌فرستد) */
export async function fetchFundList({ log = () => {} } = {}) {
  const url = `${ISIGNAL_API_BASE}/list`;
  const res = await get(url, {
    method: 'POST',
    body: LIST_PAYLOAD,
    as: 'json',
    accept: 'application/json',
    headers: { 'gateway-system': 'signal', Referer: ISIGNAL_FUND_LIST_URL, Origin: 'https://isignal.ir' },
    timeout: 25_000,
  });
  const rows = Array.isArray(res) ? res : res?.data ?? res?.items ?? res?.result ?? [];
  if (!Array.isArray(rows)) throw new Error('پاسخ فهرست صندوق‌های آی‌سیگنال آرایه نبود');
  log(`آی‌سیگنال: ${rows.length} ردیف از API دریافت شد`);
  return rows;
}

/** بارگذاری برش JSON (فایل یا شیء) */
export async function loadSnapshot(source) {
  const snap = typeof source === 'string' ? JSON.parse(await fs.readFile(source, 'utf8')) : source;
  const rows = Array.isArray(snap) ? snap : snap?.rows;
  if (!Array.isArray(rows)) throw new Error('برش آی‌سیگنال باید آرایه یا شیءِ دارای rows باشد');
  return { rows, meta: Array.isArray(snap) ? {} : snap };
}

/**
 * جمع‌آوری: ردیف‌ها (API یا برش) → محصولات آمادهٔ ادغام.
 * @param {{existing?:Array, banks?:Array, snapshot?:string|object, log?:Function, today?:string}} [opts]
 */
export async function collect({ existing = [], banks = [], snapshot, log = () => {}, today: now } = {}) {
  const snapshotPath = snapshot || process.env.ISIGNAL_JSON_FILE || null;
  let rawRows;
  let origin;
  if (snapshotPath) {
    const loaded = await loadSnapshot(snapshotPath);
    rawRows = loaded.rows;
    origin = typeof snapshotPath === 'string' ? `snapshot:${snapshotPath}` : 'snapshot:inline';
    log(`آی‌سیگنال: ${rawRows.length} ردیف از برش برون‌خط (${loaded.meta?.dataDate || '?'}) بارگذاری شد`);
  } else {
    rawRows = await fetchFundList({ log });
    origin = 'api';
  }

  const skipped = [];
  const products = [];
  const seen = new Set();
  let etf = 0;
  let issuance = 0;
  let refreshed = 0;
  for (const raw of rawRows) {
    const row = normalizeRow(raw);
    const reason = rejectReason(row);
    if (reason) {
      if (row && FIXED_INCOME_TYPES[row.typeId]) skipped.push({ id: row.id, name: row.name, reason });
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const product = mapFundToProduct(row, { banks, existing, today: now });
    if (!product) continue;
    products.push(product);
    if (row.etf) etf += 1;
    else issuance += 1;
    if (!product.autoDiscovered) refreshed += 1;
  }

  log(
    `آی‌سیگنال: ${products.length} صندوق درآمد ثابت (${etf} ETF، ${issuance} صدور/ابطالی؛ ${refreshed} به‌روزرسانی رکورد دست‌نویس)، ${skipped.length} رد شد`,
  );

  return {
    source: ISIGNAL_SOURCE_NAME,
    url: ISIGNAL_FUND_LIST_URL,
    origin,
    rows: rawRows.length,
    products,
    etf,
    issuance,
    refreshed,
    skipped,
  };
}

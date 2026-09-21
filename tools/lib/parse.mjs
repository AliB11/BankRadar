/**
 * ابزارهای نرمال‌سازی متن و اعداد فارسی/عربی.
 *
 * داده‌های بانکی ایرانی با ارقام فارسی، جداکننده هزارگان، «میلیون/میلیارد»
 * و نیم‌فاصله می‌آیند. این ماژول همه را به عدد و متن استاندارد تبدیل می‌کند.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * تبدیل ارقام فارسی/عربی به لاتین و یکسان‌سازی نویسه‌ها.
 *
 * نکته: نیم‌فاصله (U+200C) حفظ می‌شود چون در فارسی معناساز است و حذف آن
 * واژه‌های مرکب مثل «به‌جا» را به «به جا» تبدیل می‌کند. برای مقایسه و جست‌وجو
 * از foldForMatch استفاده کنید.
 */
export function normalizeText(input) {
  if (input == null) return '';
  return String(input)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '') // نشانه‌های جهت
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * نرمال‌سازی تهاجمی برای «مقایسه و تطبیق»: نیم‌فاصله، ارقام و علائم حذف می‌شوند.
 * @param {string} input
 */
export function foldForMatch(input) {
  return normalizeText(input)
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[«»"'`؛،.,:;!?()[\]{}\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** حذف تگ‌های HTML و فشرده‌سازی فاصله‌ها */
export function stripTags(html) {
  return normalizeText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/** تبدیل متن عددی به Number؛ «۲۳.۵» و «24/5» هر دو پشتیبانی می‌شوند */
export function toNumber(value) {
  const t = normalizeText(value).replace(/,/g, '').replace(/\//g, '.').replace(/[^\d.\-]/g, '');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** ضریب فارسی برای مبالغ */
const MULTIPLIERS = [
  { re: /تریلیون/, mult: 1e12 },
  { re: /(میلیارد|میليارد)/, mult: 1e9 },
  { re: /(میلیون)/, mult: 1e6 },
  { re: /(هزار)/, mult: 1e3 },
];

/**
 * استخراج مبلغ تومانی از متن فارسی.
 * «۳۰۰ میلیون تومان» → 300000000 ، «۱.۵ میلیارد» → 1500000000
 * @param {string} text
 * @returns {number|null}
 */
export function parseTomanAmount(text) {
  const t = normalizeText(text).replace(/,/g, '');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(تریلیون|میلیارد|میلیون|هزار)?/);
  if (!m) return null;

  // «۵۰٪ قیمت خودرو» یعنی سقف نسبی، نه ۵۰ تومان.
  //
  // این تمایز حیاتی است: بعضی بانک‌ها سقف وام را کسر از قیمت کالا تعریف
  // می‌کنند («معادل ۵۰ درصد قیمت خودرو»). اگر عدد را مبلغ فرض کنیم، سقفی
  // تولید می‌شود که هزار مرتبه کوچک‌تر از واقعیت است و رابط دچار تناقض
  // می‌شود (حداقل مبلغ از سقف بیشتر درمی‌آید). در چنین حالتی سقف عددی
  // نداریم؛ متن توضیحی جداگانه نگه داشته می‌شود.
  const after = t.slice(m.index + m[0].length);
  if (/^\s*(٪|%|درصد|در\s*صد)/.test(after)) return null;

  let value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2];
  if (unit) {
    const found = MULTIPLIERS.find((x) => x.re.test(unit));
    if (found) value *= found.mult;
  }
  return Math.round(value);
}

/**
 * همه مبالغ موجود در یک متن را برمی‌گرداند.
 * @param {string} text
 * @returns {number[]}
 */
export function parseAllAmounts(text) {
  const t = normalizeText(text).replace(/,/g, '');
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(تریلیون|میلیارد|میلیون|هزار)?/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    let value = Number.parseFloat(m[1]);
    if (!Number.isFinite(value)) continue;
    if (m[2]) {
      const found = MULTIPLIERS.find((x) => x.re.test(m[2]));
      if (found) value *= found.mult;
    }
    out.push(Math.round(value));
  }
  return out;
}

/**
 * نرخ‌های درصدی موجود در متن را استخراج می‌کند.
 * @param {string} text
 * @returns {number[]}
 */
export function parseRates(text) {
  const t = normalizeText(text).replace(/٫/g, '.').replace(/(\d)\/(\d)/g, '$1.$2');
  const out = [];
  const re = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:درصد|٪|%)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.push(n);
  }
  return out;
}

/**
 * تعداد روزهای کامل گذشته از یک تاریخ ISO.
 * هر دو سر مقایسه به نیمه‌شب UTC نرمال می‌شوند تا نتیجه به ساعت اجرا وابسته نباشد.
 */
export function daysSince(iso, now = new Date()) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Infinity;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(target)) return Infinity;
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((todayMs - target) / 86_400_000));
}

/** تاریخ امروز به شکل YYYY-MM-DD در تقویم میلادی */
export function today(offsetHours = 3.5) {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  return d.toISOString().slice(0, 10);
}

/** شناسه امن از متن فارسی */
export function slugify(input) {
  const t = foldForMatch(input);
  const known = {
    'بانک ملی ایران': 'melli',
    'بانک ملت': 'mellat',
    'بانک صادرات ایران': 'saderat',
    'بانک تجارت': 'tejarat',
    'بانک سپه': 'sepah',
    'بانک پاسارگاد': 'pasargad',
    'بانک سامان': 'saman',
    'بانک پارسیان': 'parsian',
    'بانک اقتصاد نوین': 'eghtesad-novin',
    'بانک کارآفرین': 'karafarin',
    'بانک رفاه کارگران': 'refah',
    'بانک مسکن': 'maskan',
    'بانک کشاورزی': 'keshavarzi',
    'بلوبانک': 'blubank',
    'ویپاد': 'vipad',
  };
  const folded = foldForMatch(input);
  for (const [fa, id] of Object.entries(known)) {
    if (folded.includes(foldForMatch(fa))) return id;
  }
  return (
    t
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'unknown'
  );
}

/* ------------------------------------------------------------------ */
/* تطبیق نام بانک و ساخت شناسه لاتین (پیش‌تر در sync-weekly)             */
/* ------------------------------------------------------------------ */

export function matchBank(rawBankName, bankList = []) {
  if (!rawBankName) return { id: 'unknown', name: 'نامشخص' };
  const folded = foldForMatch(rawBankName);

  for (const b of bankList) {
    if (foldForMatch(b.name) === folded) return b;
    if (Array.isArray(b.aliases)) {
      for (const alias of b.aliases) {
        if (foldForMatch(alias) === folded) return b;
      }
    }
  }

  // جست‌وجوی تطبیق زیررشته‌ای با دو محافظ:
  //   ۱. واژه‌های عام (مثل «بانک») نباید به‌صورت تصادفی به نخستین بانک فهرست
  //      بچسبند؛ هم به‌عنوان ورودی و هم به‌عنوان نام بانک نادیده گرفته می‌شوند.
  //   ۲. از میان چند نامزد، بلندترین تطبیق انتخاب می‌شود تا نتیجه به ترتیب
  //      فهرست وابسته نباشد.
  const GENERIC = new Set(['بانک', 'مؤسسه', 'موسسه', 'اعتباری', 'قرض الحسنه', 'ایران', 'اسلامی', 'کارگزاری', 'صندوق']);
  if (GENERIC.has(folded)) return { id: slugify(rawBankName), name: rawBankName.trim() };

  let best = null;
  let bestLen = 0;
  const consider = (b, raw) => {
    const needle = foldForMatch(raw);
    if (!needle || GENERIC.has(needle)) return;
    const hit = folded.includes(needle) || needle.includes(folded);
    if (hit && needle.length > bestLen) {
      best = b;
      bestLen = needle.length;
    }
  };
  for (const b of bankList) {
    consider(b, b.name);
    if (Array.isArray(b.aliases)) {
      for (const alias of b.aliases) consider(b, alias);
    }
  }
  if (best) return best;

  return { id: slugify(rawBankName), name: rawBankName.trim() };
}

/**
 * ساخت شناسه لاتین معتبر برای رکورد ورودی.
 *
 * slugify نام‌های فارسی ناشناخته را با حروف فارسی برمی‌گرداند (که برای نام بانک
 * خوب است) اما شناسه محصول باید با الگوی `^[a-z0-9][a-z0-9-]*$` بخواند وگرنه
 * اعتبارسنجی داده، کل درون‌ریزی را رد می‌کند. برای بخش فارسی، اثر انگشت پایدار
 * ساخته می‌شود تا دو محصول متفاوت شناسه یکسان نگیرند.
 */
export function makeLatinId(bankId, productTitle) {
  const h = [...foldForMatch(productTitle)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
  const head = `${slugify(bankId)}-${slugify(productTitle)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const tail = h.toString(36);
  return (head && /^[a-z0-9]/.test(head) ? `${head}-${tail}` : `imp-${tail}`).slice(0, 60);
}

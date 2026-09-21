/**
 * ابزارهای پایه: قالب‌بندی اعداد و متن فارسی، ساخت امن DOM، و کمک‌کارهای ذخیره‌سازی.
 *
 * توجه امنیتی: در نسخه قبلی سامانه، مقادیر داده مستقیماً در قالب رشته HTML
 * تزریق می‌شدند که امکان تزریق اسکریپت از داده واردشده را فراهم می‌کرد.
 * در این نسخه همه مقادیر متنی از esc() عبور می‌کنند و رویدادها با delegation
 * مدیریت می‌شوند (هیچ onclick درون‌خطی وجود ندارد).
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** تبدیل ارقام لاتین به فارسی برای نمایش */
export function fa(value) {
  if (value === null || value === undefined) return '—';
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** فرار دادن کاراکترهای خاص HTML — دفاع اصلی در برابر تزریق */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** فرار دادن مقدار برای قرار گرفتن در attribute سبک/شناسه */
export function escAttr(value) {
  return esc(value).replace(/[^a-zA-Z0-9\u0600-\u06FF\-_ :;.,#%()]/g, '');
}

/**
 * پاک‌سازی نشانی برای درج در href.
 *
 * esc() فقط کاراکترهای خطرناک HTML را خنثی می‌کند و طرح نشانی را بررسی نمی‌کند؛
 * بنابراین «javascript:alert(1)» از esc عبور می‌کند و به‌عنوان href قابل اجرا می‌ماند.
 * این تابع تنها طرح‌های امن (http، https، mailto) را می‌پذیرد و در غیر این صورت
 * رشته خالی برمی‌گرداند تا لینک بی‌اثر شود.
 *
 * @param {string} url
 * @returns {string} نشانی امن یا رشته خالی
 */
export function safeUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw) return '';

  // حذف کاراکترهای کنترلی و فاصله‌های پنهان که برای دورزدن فیلتر استفاده می‌شوند
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, '');
  const lower = cleaned.toLowerCase();

  const allowed = ['http://', 'https://', 'mailto:'];
  const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(lower);

  if (hasScheme && !allowed.some((p) => lower.startsWith(p))) return '';
  // نشانی بدون طرح (مسیر نسبی) هم پذیرفته می‌شود
  if (!hasScheme && !lower.startsWith('//') && !lower.startsWith('#')) {
    return esc(cleaned);
  }
  if (lower.startsWith('//')) return ''; // نشانی پروتکل‌نسبی مسدود می‌شود
  return esc(cleaned);
}

/** جداکننده هزارگان + ارقام فارسی */
export function faNum(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const fixed = Number(value).toFixed(digits);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fa(dec ? `${grouped}.${dec}` : grouped);
}

/**
 * قالب‌بندی مبلغ تومانی به شکل خوانا و کوتاه‌شده.
 * 300000000 → «۳۰۰ میلیون تومان»
 */
export function faToman(value, { short = true } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const n = Number(value);
  if (!short) return `${faNum(n)} تومان`;

  const abs = Math.abs(n);
  const units = [
    [1e12, 'هزار میلیارد'],
    [1e9, 'میلیارد'],
    [1e6, 'میلیون'],
    [1e3, 'هزار'],
  ];
  for (const [scale, label] of units) {
    if (abs >= scale) {
      const v = n / scale;
      const rounded = Math.abs(v % 1) < 0.01 ? v.toFixed(0) : v.toFixed(1);
      return `${faNum(Number(rounded), rounded.includes('.') ? 1 : 0)} ${label} تومان`;
    }
  }
  return `${faNum(n)} تومان`;
}

/** نمایش درصد */
export function faPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const v = Number(value);
  const rounded = Math.abs(v % 1) < 0.05 ? v.toFixed(0) : v.toFixed(digits);
  return `${fa(rounded)}٪`;
}

/** درصد با علامت مثبت/منفی (برای نرخ واقعی) */
export function faSignedPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const v = Number(value);
  const rounded = Math.abs(v % 1) < 0.05 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fa(rounded)}٪`;
}

/** تاریخ ISO → نمایش شمسی خوانا */
const J_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

export function faDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const { jy, jm, jd } = g2j(Number(m[1]), Number(m[2]), Number(m[3]));
  return `${fa(jd)} ${J_MONTHS[jm - 1] ?? ''} ${fa(jy)}`;
}

/** تعداد روز گذشته از تاریخ ISO */
export function daysSince(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Infinity;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // تاریخ نامعتبر (ماه ۱۹ یا روز ۹۹) نباید با سرریز Date.UTC به «امروز» یا
  // آینده تبدیل شود؛ برای داده خراب، حکم «کهنه/نامشخص» امن‌تر است.
  if (month < 1 || month > 12 || day < 1 || day > 31) return Infinity;
  const target = Date.UTC(year, month - 1, day);
  if (Number.isNaN(target)) return Infinity;
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((todayMs - target) / 86_400_000));
}

/** «۳ روز پیش» / «امروز» */
export function faAgo(iso) {
  const d = daysSince(iso);
  if (!Number.isFinite(d)) return 'نامشخص';
  if (d === 0) return 'امروز';
  if (d === 1) return 'دیروز';
  if (d < 31) return `${fa(d)} روز پیش`;
  if (d < 365) return `${fa(Math.round(d / 30))} ماه پیش`;
  // تقسیم روز بر ۱۲ (ماه) سال را چند برابر بزرگ نشان می‌داد: ۵۰۰ روز → «۴۲ سال پیش»
  return `${fa(Math.round(d / 365))} سال پیش`;
}

/** وضعیت تازگی: خوب/هشدار/کهنه */
export function freshness(iso) {
  const d = daysSince(iso);
  if (d <= 30) return 'good';
  if (d <= 90) return 'warn';
  return 'bad';
}

/* تبدیل میلادی↔شمسی (نسخه سبک سمت مرورگر؛ هم‌الگوریتم با tools/lib/jalali.mjs) */
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.floor(a / b) * b;

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** میلادی → روز ژولینی */
const g2d = (gy, gm, gd) =>
  div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
  div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408 -
  div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;

/** روز ژولینی → میلادی */
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** میلادی → شمسی */
export function g2j(gy, gm, gd) {
  const jdn = g2d(gy, gm, gd);
  const gYear = d2g(jdn).gy;
  let jy = gYear - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gYear, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** تاریخ امروز به میلادی ISO */
export function todayISO() {
  const d = new Date(Date.now() + 3.5 * 3_600_000);
  return d.toISOString().slice(0, 10);
}

/* --- کمک‌کارهای DOM --- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** ساخت امن گره با متن (بدون innerHTML) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // فقط برای قالب‌های داخلی کنترل‌شده
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** قالب رشته‌ای امن: برچسب‌های ${} به‌صورت پیش‌فرض فرار داده می‌شوند */
export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    return acc + (v && v.__raw ? v.value : esc(v)) + s;
  }, '');
}

/** علامت‌گذاری رشته به‌عنوان HTML امن (فقط برای قالب‌های داخلی) */
export const raw = (value) => ({ __raw: true, value: String(value ?? '') });

/* --- ذخیره‌سازی مقاوم --- */

const PREFIX = 'bankradar.v2.';

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* نادیده */
    }
  },
};

/** تأخیر برای debounce */
export function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** اتلاف ارقام تکراری */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

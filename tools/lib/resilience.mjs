/**
 * لایه «منبع جایگزین» برای واکشی داده.
 *
 * چرا لازم است: آزمون زندهٔ ۱۲ آبان ۱۴۰۵ نشان داد بخش بزرگی از منابع ایرانی
 * از بیرون ایران (Runner گیت‌هاب یا هر سرور خارجی) در دسترس نیستند:
 *
 *   - سایت بانک ملی صریحاً می‌گوید «دسترسی از IP یا منطقهٔ جغرافیایی شما محدود
 *     شده است» (۴۰۳ با کد ۶۱۰۰) — یعنی مشکل مجوز یا کاربرگستر نیست، ژئوبلاک است؛
 *     تعویض User-Agent این را حل نمی‌کند.
 *   - دیجی‌شهر صفحهٔ «فیلترشکن خود را خاموش کنید» برمی‌گرداند.
 *   - نشانی‌های قدیمی بانک مرکزی (simplelist) اکنون ۲۰۰ با متن «Page Not Found»
 *     می‌دهند؛ کد واکشی این را «موفق» می‌شمرد و نرخ خالی برمی‌گرداند — خطای
 *     بی‌صدا. این ماژول همان صفحه را «نامعتبر» می‌شناسد و زنجیره را ادامه می‌دهد.
 *
 * زنجیرهٔ جایگزین، به ترتیب:
 *   ۱. نشانی اصلی
 *   ۲. آینه‌های اعلام‌شده برای همان منبع (نسخهٔ دیگر دامنه/مسیر)
 *   ۳. آرشیو اینترنت (Wayback) — با تاریخ snapshot، نه تاریخ امروز
 *   ۴. پروکسی متن (r.jina.ai) — آخرین راه، با علامت «تحلیل‌نشده/کاهش اطمینان»
 *
 * قواعد:
 *   - هرگز دادهٔ قدیمی را «تازه» جا نمی‌زنیم: snapshot تاریخ خودش را دارد و
 *     `observedAt` همان است.
 *   - هرگز یک خطا، کل زنجیره را با استثنای بی‌پیام قطع نمی‌کند؛ همهٔ تلاش‌ها
 *     با دلیل در `attempts` برمی‌گردند.
 *   - تابع خالص و قابل آزمون است: `fetchImpl` تزریق می‌شود تا در آزمون بدون
 *     شبکه اجرا شود.
 */

import { get, sleep, describeError } from './http.mjs';

export const WAYBACK_AVAILABLE = 'https://archive.org/wayback/available';
export const WAYBACK_BASE = 'https://web.archive.org/web';
export const TEXT_PROXY = 'https://r.jina.ai/';

/** نشانه‌های صفحهٔ «پیدا نشد» که با کد ۲۰۰ هم برمی‌گردند */
const NOT_FOUND_RE =
  /(page\s+not\s+found|صفحه\s*مورد\s*نظر\s*یافت\s*نشد|۴۰۴|the page could not be found)/i;

/** نشانه‌های ژئوبلاک/فیلتر جغرافیایی */
const GEO_BLOCK_RE =
  /(فیلترشکن|دسترسی از\s*IP|blocked from your IP|your location|geo.?block|کشور شما)/i;

/** صفحه‌های «مشکل امنیتی» که محتوای واقعی ندارند */
const WAF_RE = /(access denied|request blocked|security settings|درخواست شما مسدود)/i;

/**
 * تشخیص وضعیت یک پاسخ: آیا محتوای دریافتی «دادهٔ واقعی» است یا صفحهٔ خطا؟
 *
 * چرا جدا از کد HTTP: بانک مرکزی صفحهٔ حذف‌شده را با کد ۲۰۰ و متن
 * «Page Not Found» برمی‌گرداند. اگر فقط کد را ببینیم، «موفق» ثبت می‌شود و
 * نرخ خالی به گزارش می‌رود.
 *
 * @param {{status?:number, body?:string, minBytes?:number}} input
 * @returns {{valid:boolean, reason:string|null, blocked:'geo'|'waf'|'notfound'|'thin'|null}}
 */
export function classifyContent({ status = 200, body = '', minBytes = 160 } = {}) {
  const text = String(body ?? '');
  if (status >= 400) {
    return { valid: false, reason: `HTTP ${status}`, blocked: status === 403 || status === 429 ? 'waf' : null };
  }
  if (GEO_BLOCK_RE.test(text)) return { valid: false, reason: 'ژئوبلاک — دسترسی از این منطقه بسته است', blocked: 'geo' };
  if (NOT_FOUND_RE.test(text)) return { valid: false, reason: 'صفحهٔ «پیدا نشد» با کد ۲۰۰', blocked: 'notfound' };
  if (WAF_RE.test(text) && text.length < 2500) {
    return { valid: false, reason: 'دیوار محافظ (WAF) — محتوای واقعی برنگشت', blocked: 'waf' };
  }
  if (text.trim().length < minBytes) {
    return { valid: false, reason: `محتوای ناکافی (${text.trim().length} بایت)`, blocked: 'thin' };
  }
  return { valid: true, reason: null, blocked: null };
}

/** تاریخ فشردهٔ Wayback (YYYYMMDDhhmmss) → ISO */
export function waybackTimestampToISO(ts) {
  const m = String(ts ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

/** اختلاف روز بین دو تاریخ (بدون منفی) */
export function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** یک snapshot را به نشانی «محتوای خام» تبدیل می‌کند (`id_` یعنی بدون قالب آرشیو) */
export function rawSnapshotUrl(snapshotUrl) {
  return String(snapshotUrl ?? '').replace(/\/web\/(\d+)\//, '/web/$1id_/');
}

/** کش کوتاه‌مدت پاسخ‌های Wayback؛ کلید = نشانی منبع */
const waybackCache = new Map();

/** صف سریالی برای احترام به نرخ‌محدودیت آرشیو */
let waybackQueue = Promise.resolve();
const WAYBACK_GAP_MS = 900;
function queueWayback(task) {
  const run = waybackQueue.then(async () => {
    await sleep(WAYBACK_GAP_MS);
    return task();
  });
  waybackQueue = run.catch(() => {});
  return run;
}

/**
 * جست‌وجوی نزدیک‌ترین snapshot در آرشیو اینترنت.
 * خطای ۴۲۹ (محدودیت نرخ) یا هر خطای دیگر → null، نه استثنا؛ زنجیره ادامه می‌یابد.
 *
 * @param {string} url
 * @param {{fetchImpl?:Function, timeout?:number, timestamp?:string}} [opts]
 * @returns {Promise<{snapshotUrl:string, at:string|null, timestamp:string}|null>}
 */
export async function lookupWayback(url, opts = {}) {
  const { fetchImpl = get, timeout = 12_000, timestamp = '' } = opts;

  // آرشیو اینترنت نرخ‌محدود است: ۲۵ هدف هم‌زمان = ۴۲۹ و snapshot گم‌شده.
  // در آزمون زندهٔ ۱۲ آبان ۱۴۰۵ همین اتفاق افتاد. پس درخواست‌ها پشت یک صف
  // سریالی با فاصلهٔ زمانی می‌روند و پاسخ‌ها کش می‌شوند.
  const cached = waybackCache.get(url);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;

  const value = await queueWayback(async () => {
    const api = `${WAYBACK_AVAILABLE}?url=${encodeURIComponent(url)}${timestamp ? `&timestamp=${timestamp}` : ''}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await fetchImpl(api, { timeout, retries: 0, as: 'text' });
        const parsed = JSON.parse(String(raw));
        const closest = parsed?.archived_snapshots?.closest;
        if (!closest?.available || !closest.url) return null;
        return { snapshotUrl: closest.url, at: waybackTimestampToISO(closest.timestamp), timestamp: String(closest.timestamp ?? '') };
      } catch (err) {
        if (/429|Too Many Requests/i.test(String(err?.message ?? '')) && attempt === 0) {
          await sleep(2_500);
          continue;
        }
        return null;
      }
    }
    return null;
  });

  waybackCache.set(url, { at: Date.now(), value });
  return value;
}

/**
 * واکشی مقاوم با زنجیرهٔ جایگزین.
 *
 * @param {string} url نشانی اصلی
 * @param {{
 *   mirrors?:string[], allowWayback?:boolean, allowProxy?:boolean,
 *   timeout?:number, retries?:number, minBytes?:number,
 *   fetchImpl?:Function, waybackLookup?:Function, now?:() => Date,
 *   headers?:Record<string,string>
 * }} [opts]
 * @returns {Promise<{
 *   text:string, via:'direct'|'mirror'|'wayback'|'proxy', url:string,
 *   resolvedUrl:string, observedAt:string, ageDays:number|null,
 *   degraded:boolean, attempts:Array<{url:string, via:string, ok:boolean, reason?:string}>
 * }>}
 * @throws {Error} خطای `AllSourcesFailed` با `attempts` وقتی همهٔ مسیرها بسته‌اند
 */
export async function fetchResilient(url, opts = {}) {
  const {
    mirrors = [],
    allowWayback = true,
    allowProxy = true,
    timeout = 20_000,
    retries = 1,
    minBytes = 160,
    fetchImpl = get,
    waybackLookup = lookupWayback,
    now = () => new Date(),
    headers = {},
  } = opts;

  const attempts = [];
  const nowISO = now().toISOString();

  const tryOne = async (candidate, via) => {
    try {
      const text = String(await fetchImpl(candidate, { timeout, retries, headers }));
      const verdict = classifyContent({ status: 200, body: text, minBytes });
      if (!verdict.valid) {
        attempts.push({ url: candidate, via, ok: false, reason: verdict.reason });
        return null;
      }
      attempts.push({ url: candidate, via, ok: true });
      return {
        text,
        via,
        url,
        resolvedUrl: candidate,
        observedAt: nowISO,
        ageDays: 0,
        degraded: via === 'proxy',
        attempts,
      };
    } catch (err) {
      const reason = describeError(err);
      const blocked = /۴۰۳|403/.test(reason) ? 'waf' : null;
      attempts.push({ url: candidate, via, ok: false, reason, ...(blocked ? { blocked } : {}) });
      return null;
    }
  };

  // ۱) اصلی
  const direct = await tryOne(url, 'direct');
  if (direct) return direct;

  // ۲) آینه‌ها
  for (const mirror of mirrors.filter((m) => m && m !== url)) {
    const hit = await tryOne(mirror, 'mirror');
    if (hit) return hit;
  }

  // ۳) آرشیو اینترنت — تاریخ خودِ snapshot ملاک است، نه امروز
  if (allowWayback) {
    const snapshot = await waybackLookup(url, { fetchImpl, timeout: Math.min(timeout, 12_000) });
    if (snapshot?.snapshotUrl) {
      const rawUrl = rawSnapshotUrl(snapshot.snapshotUrl);
      try {
        const text = String(await fetchImpl(rawUrl, { timeout, retries: 0, headers }));
        const verdict = classifyContent({ body: text, minBytes });
        if (verdict.valid) {
          attempts.push({ url: rawUrl, via: 'wayback', ok: true });
          return {
            text,
            via: 'wayback',
            url,
            resolvedUrl: rawUrl,
            observedAt: snapshot.at ?? nowISO,
            ageDays: snapshot.at ? daysBetween(snapshot.at, nowISO) : null,
            degraded: true,
            attempts,
          };
        }
        attempts.push({ url: rawUrl, via: 'wayback', ok: false, reason: verdict.reason });
      } catch (err) {
        attempts.push({ url: rawUrl, via: 'wayback', ok: false, reason: describeError(err) });
      }
    } else {
      attempts.push({ url: `${WAYBACK_AVAILABLE}?url=${url}`, via: 'wayback', ok: false, reason: 'snapshot یافت نشد' });
    }
  }

  // ۴) پروکسی متن — آخرین راه؛ ساختار HTML تضمین نمی‌شود
  if (allowProxy) {
    const proxied = `${TEXT_PROXY}${url}`;
    try {
      const text = String(await fetchImpl(proxied, { timeout, retries: 0 }));
      const verdict = classifyContent({ body: text, minBytes: Math.min(minBytes, 200) });
      if (verdict.valid) {
        attempts.push({ url: proxied, via: 'proxy', ok: true });
        return {
          text,
          via: 'proxy',
          url,
          resolvedUrl: proxied,
          observedAt: nowISO,
          ageDays: 0,
          degraded: true,
          attempts,
        };
      }
      attempts.push({ url: proxied, via: 'proxy', ok: false, reason: verdict.reason });
    } catch (err) {
      attempts.push({ url: proxied, via: 'proxy', ok: false, reason: describeError(err) });
    }
  }

  const err = new Error(`همهٔ مسیرهای «${url}» بسته بود — ${attempts.map((a) => `${a.via}: ${a.reason ?? 'x'}`).join(' | ')}`);
  err.name = 'AllSourcesFailed';
  err.attempts = attempts;
  err.url = url;
  throw err;
}

/**
 * خلاصهٔ خوانا از زنجیرهٔ تلاش‌ها برای گزارش خط لوله.
 * @param {Array<{via:string, ok:boolean, reason?:string}>} attempts
 */
export function summarizeAttempts(attempts = []) {
  if (!attempts.length) return 'بدون تلاش';
  return attempts
    .map((a) => `${a.via}${a.ok ? '✓' : `✗(${a.reason ?? '?'})`}`)
    .join(' ← ');
}

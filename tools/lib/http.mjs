/**
 * لایه شبکه مقاوم برای جمع‌آوری داده.
 *
 * سایت بانک‌های ایرانی اغلب کند، ناپایدار یا محافظت‌شده هستند؛ این ماژول
 * timeout، retry با backoff، تلاش مجدد هوشمند و هدرهای واقع‌گرایانه را
 * فراهم می‌کند تا یک منبع خراب کل خط لوله را متوقف نکند.
 *
 * سه قاعده‌ای که این فایل تضمین می‌کند:
 *
 *   ۱. خطای دائمی را دوباره تلاش نکن — ۴۰۳ و ۴۰۴ با تلاش مجدد درست نمی‌شوند
 *      و فقط وقت اجرا و پهنای باند منبع را تلف می‌کنند. ۵xx/۴۲۹/۴۰۸ گذرا
 *      هستند و باید دوباره امتحان شوند.
 *   ۲. خطای یک کار، بقیه کارها را نکشد — در صف موازی، هر کار مستقل شکست
 *      می‌خورد و خطا به گزارش می‌رود، نه به‌صورت استثنای سرگردان.
 *   ۳. هر خطا باید بگوید چه شد و کجا — «دریافت ناموفق» برای عیب‌یابی
 *      بی‌فایده است. دامنه، کد وضعیت، مهلت و نوع خطا ثبت می‌شوند.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; BankRadarBot/2.0; +https://github.com/AliB11/BankRadar)';

/** تأخیر ساده */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** خطای شبکه با اطلاعات کافی برای گزارش‌دهی */
export class FetchError extends Error {
  constructor(url, message, { status = 0, ms = 0, kind } = {}) {
    super(`${message}${status ? ` (HTTP ${status})` : ''} — ${url}`);
    this.name = 'FetchError';
    this.url = url;
    this.status = status;
    this.ms = ms;
    // اگر کد وضعیت داریم، خطا از نوع HTTP است؛ وگرنه شبکه. اگر این را
    // جابه‌جا بگیریم، خطای ۴۰۴ «گذرا» شمرده می‌شود و بی‌دلیل تکرار می‌گردد.
    this.kind = kind || (status ? 'http' : 'network');
    // خطاهایی که با تلاش مجدد درست می‌شوند
    this.transient =
      this.kind === 'network' || status >= 500 || status === 429 || status === 408;
  }
}

/** ترجمه خطای خام به جمله‌ای که در گزارش قابل فهم باشد */
export function describeError(err) {
  const name = err?.name || '';
  const msg = err?.message || String(err);
  if (name === 'AbortError' || /aborted|timeout/i.test(msg)) return 'پایان مهلت درخواست';
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(msg)) return 'خطای تفکیک نام دامنه';
  if (/ECONNREFUSED/i.test(msg)) return 'اتصال رد شد';
  if (/ECONNRESET|socket hang up/i.test(msg)) return 'اتصال قطع شد';
  if (/certificate|SSL|TLS|self.signed/i.test(msg)) return 'خطای گواهی TLS';
  if (/fetch failed/i.test(msg)) return 'شبکه در دسترس نبود';
  if (/JSON/i.test(msg)) return 'پاسخ JSON نامعتبر بود';
  return msg.slice(0, 160);
}

/**
 * یک درخواست GET با timeout و retry.
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:Record<string,string>, as?:'text'|'json'|'response', accept?:string, signal?:AbortSignal}} [opts]
 * @returns {Promise<string|any>}
 */
export async function get(url, opts = {}) {
  const {
    timeout = 20_000,
    retries = 2,
    headers = {},
    as = 'text',
    accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    signal,
  } = opts;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // بازه زمانی نمایی با نوسان تصادفی تا چند کارگر هم‌زمان به سایت نکوبند
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1) + Math.random() * 300);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    const started = Date.now();

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: accept,
          'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          ...headers,
        },
      });
      const ms = Date.now() - started;

      if (!res.ok) {
        const err = new FetchError(url, `HTTP ${res.status} ${res.statusText}`.trim(), {
          status: res.status,
          ms,
          kind: 'http',
        });
        // خطای دائمی: بلافاصله بالا می‌رود، بدون تلاش دوباره
        if (!err.transient) throw err;
        lastError = err;
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        const text = buf.toString('utf8');

        if (as === 'response') {
          return { url, finalUrl: res.url || url, status: res.status, text, bytes: buf.length, ms };
        }
        if (as === 'json') {
          try {
            return JSON.parse(text);
          } catch {
            throw new FetchError(url, 'پاسخ JSON نامعتبر بود', { status: res.status, ms, kind: 'parse' });
          }
        }
        return text;
      }
    } catch (err) {
      const ms = Date.now() - started;
      if (err instanceof FetchError) {
        if (!err.transient && err.kind !== 'parse') throw err;
        if (err.kind === 'parse') throw err;
        lastError = err;
      } else {
        lastError = new FetchError(url, describeError(err), { ms });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new FetchError(url, 'دریافت ناموفق بود');
}

/**
 * دریافت متن به‌همراه فراداده پاسخ (زمان، حجم، نشانی نهایی).
 * وقتی می‌خواهیم در گزارش بنویسیم «کدام صفحه چند میلی‌ثانیه و چند بایت بود».
 *
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:Record<string,string>, accept?:string, signal?:AbortSignal}} [opts]
 * @returns {Promise<{url:string, finalUrl:string, status:number, body:string, ms:number, bytes:number}>}
 */
export async function fetchText(url, opts = {}) {
  const res = await get(url, { ...opts, as: 'response' });
  return { url, finalUrl: res.finalUrl, status: res.status, body: res.text, ms: res.ms, bytes: res.bytes };
}

/**
 * اجرای امن یک منبع؛ خطا را می‌گیرد و وضعیت سلامت برمی‌گرداند.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<{name:string, ok:boolean, data?:T, error?:string, ms:number}>}
 */
export async function runSource(name, fn) {
  const started = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, data, ms: Date.now() - started };
  } catch (err) {
    return { name, ok: false, error: describeError(err), ms: Date.now() - started };
  }
}

/**
 * اجرای محدودشده موازی.
 *
 * نکته مهم: اگر یک کار استثنا پرتاب کند، کل صف نمی‌خوابد. خطا به‌شکل
 * {ok:false, error} برگردانده می‌شود تا یک صفحه خراب، بقیه محصولات را
 * از دست ندهد. (پیش‌تر یک استثنا، Promise.all را رد می‌کرد و کل منبع
 * از دست می‌رفت.)
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<Array<{ok:true,data:T}|{ok:false,error:string,errorObject:Error}>>}
 */
export async function pool(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, data: await tasks[i]() };
      } catch (err) {
        results[i] = { ok: false, error: describeError(err), errorObject: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * بازکردن پاکتِ نتایج `pool` و بازگرداندن زمینه هر کار.
 *
 * چرا لازم است: `pool` هر نتیجه را در `{ok,data}` می‌پیچد تا استثنای یک کار
 * بقیه را نکشد. اگر مصرف‌کننده همان پاکت را «نتیجه کار» فرض کند، دو اتفاق
 * بد می‌افتد:
 *
 *   ۱. دسترسی به زمینه (مثل `r.target.id`) با «undefined» استثنا می‌دهد و کل
 *      منبع از دست می‌رود.
 *   ۲. داده واقعی یک لایه عمیق‌تر است؛ بنابراین آنچه «محصول» خوانده می‌شود
 *      پوسته‌ای بدون فیلد `product` است و ادغام، بی‌صدا آن را دور می‌اندازد
 *      (خط لوله موفق گزارش می‌شود ولی داده‌ای به‌روز نمی‌شود).
 *
 * @template T
 * @param {Array<{ok:true,data:any}|{ok:false,error?:string,errorObject?:Error}>} wrapped
 * @param {T[]} contexts زمینه هر کار (هم‌ترتیب با tasks)
 * @param {string} contextKey نام کلیدی که زمینه با آن بازمی‌گردد
 * @returns {Array<any>}
 */
export function unwrapPool(wrapped, contexts = [], contextKey = 'context') {
  return (wrapped ?? []).map((w, i) => {
    if (w && w.ok) return w.data;
    const error = w?.error ?? (w?.errorObject ? describeError(w.errorObject) : 'خطای نامشخص');
    return { [contextKey]: contexts[i], ok: false, error };
  });
}

/**
 * نقشه‌برداری موازی روی یک آرایه با حفظ ترتیب.
 * @template T,U
 * @param {T[]} items
 * @param {(item:T, index:number)=>Promise<U>} worker
 * @param {{concurrency?:number, onProgress?:(done:number,total:number,item:T,error:Error|null)=>void}} [opts]
 * @returns {Promise<{results:U[], errors:{item:T, error:Error}[]}>}
 */
export async function poolMap(items, worker, opts = {}) {
  const { concurrency = 5, onProgress } = opts;
  const results = new Array(items.length);
  const errors = [];
  let cursor = 0;
  let done = 0;

  const size = Math.max(1, Math.min(concurrency, items.length || 1));

  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const item = items[index];
      try {
        results[index] = await worker(item, index);
        if (onProgress) onProgress((done += 1), items.length, item, null);
      } catch (error) {
        errors.push({ item, error });
        if (onProgress) onProgress((done += 1), items.length, item, error);
      }
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return { results: results.filter((r) => r !== undefined), errors };
}

/** کنترل مهلت کل یک منبع، تا یک سایت کند کل اجرا را نخورد */
export function withDeadline(ms, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`مهلت ${label} تمام شد`)), ms);
  if (timer.unref) timer.unref();
  return {
    signal: ctrl.signal,
    done: () => clearTimeout(timer),
    get expired() {
      return ctrl.signal.aborted;
    },
  };
}

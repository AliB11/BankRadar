/**
 * خواندن نقشه سایت (sitemap).
 *
 * چرا از sitemap استفاده می‌کنیم و نه پیمایش صفحه‌به‌صفحه: نقشه سایت تنها
 * فهرست کامل و رسمی یک سایت است و برای هر نشانی، تاریخ آخرین تغییر را هم
 * می‌دهد. با آن می‌توان فقط صفحه‌های تازه را واکشی کرد، که هم سریع‌تر است
 * و هم فشار کمتری به منبع وارد می‌کند.
 */

import { fetchText } from './http.mjs';

const LOC_RE = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
const LAST_MOD_RE = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/gi;

/** خواندن متن یک تگ XML، با رفع ارجاع‌های متنی */
function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * جدا کردن ورودی‌های یک نقشه سایت.
 *
 * با regex کار می‌کنیم نه XML parser، چون نقشه‌های سایت در عمل گاهی XML
 * نامعتبر دارند (کاراکتر & خام، namespace گم‌شده) و parser سخت‌گیر کل کار
 * را متوقف می‌کند. ساختار این فایل‌ها کاملاً تخت و ساده است.
 *
 * @param {string} xml
 * @returns {{url:string, lastmod:string|null}[]}
 */
export function parseUrlset(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const out = [];
  // هر <url> را جدا می‌خوانیم تا lastmod به loc درست بچسبد.
  const blocks = xml.split(/<url[\s>]/i).slice(1);
  for (const block of blocks) {
    const loc = block.match(LOC_RE);
    if (!loc || !loc[0]) continue;
    const mod = block.match(LAST_MOD_RE);
    out.push({
      url: unescapeXml(loc[0].replace(/<\/?loc>/gi, '')),
      lastmod: mod ? unescapeXml(mod[0].replace(/<\/?lastmod>/gi, '')) : null,
    });
  }
  // اگر ساختار بلوکی به هم ریخته بود، به حالت خطی برگرد تا داده از دست نرود.
  if (!out.length) {
    const locs = [...xml.matchAll(LOC_RE)].map((m) => unescapeXml(m[1]));
    return locs.map((url) => ({ url, lastmod: null }));
  }
  // فقط نشانی‌هایی که واقعاً صفحه‌اند، نه فایل پیوست
  return out.filter((e) => /^https?:\/\//i.test(e.url));
}

/** آیا این فایل یک «نمایه نقشه سایت» است؟ */
export function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml || '');
}

/**
 * خواندن یک نقشه سایت. اگر خودش نمایه باشد، همه زیرنقشه‌های داده‌شده را
 * موازی می‌خواند و یک فهرست یکدست برمی‌گرداند.
 *
 * @param {string} url
 * @param {{select?:(u:string)=>boolean, concurrency?:number, timeout?:number}} [opts]
 */
export async function readSitemap(url, opts = {}) {
  const { select, concurrency = 4, timeout = 25_000 } = opts;
  const root = await fetchText(url, { accept: 'application/xml,text/xml,*/*', timeout });

  if (!isSitemapIndex(root.body)) {
    return { entries: parseUrlset(root.body), children: [], ms: root.ms };
  }

  let children = parseUrlset(root.body).map((e) => e.url);
  if (select) children = children.filter(select);

  const entries = [];
  let ms = root.ms;
  // نقشه‌های فرزند را یکی‌یکی می‌خوانیم؛ تعدادشان کم است و هم‌زمانی زیاد
  // فقط بار منبع را بالا می‌برد.
  for (const child of children) {
    try {
      const res = await fetchText(child, { accept: 'application/xml,text/xml,*/*', timeout, retries: 2 });
      ms += res.ms;
      entries.push(...parseUrlset(res.body));
    } catch {
      // یک نقشه فرزند خراب نباید بقیه را از کار بیندازد
    }
  }
  return { entries, children, ms };
}

/**
 * مرتب‌سازی ورودی‌ها بر اساس تاریخ تغییر (تازه‌ترین اول) و بریدن تعداد.
 *
 * ترتیب تازه‌ترین‌اول مهم است: اگر بخواهیم سقف تعداد را رعایت کنیم،
 * منطقی است که تازه‌ترین صفحه‌ها را بگیریم نه تصادفی‌ها را.
 *
 * @param {{url:string,lastmod:string|null}[]} entries
 * @param {{sinceDays?:number, limit?:number, now?:number}} [opts]
 */
export function pickRecent(entries, opts = {}) {
  const { sinceDays, limit, now = Date.now() } = opts;
  const cutoff = sinceDays ? now - sinceDays * 86_400_000 : null;

  const scored = entries.map((e) => {
    const t = e.lastmod ? Date.parse(e.lastmod) : NaN;
    return { ...e, time: Number.isFinite(t) ? t : 0 };
  });

  const fresh = cutoff ? scored.filter((e) => e.time >= cutoff) : scored;
  // اگر بریدن زمانی همه چیز را حذف کرد، محدودیت را نادیده بگیر: بهتر است
  // داده کهنه بدهیم تا هیچ داده‌ای ندهیم.
  const base = fresh.length ? fresh : scored;

  base.sort((a, b) => b.time - a.time || a.url.localeCompare(b.url));
  return limit ? base.slice(0, limit) : base;
}

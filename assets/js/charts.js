/**
 * نمودارهای سبک بر پایه SVG درون‌خطی.
 * دلیل انتخاب SVG بدون کتابخانه: حجم صفر اضافه، سازگاری کامل با RTL و چاپ،
 * و امکان رنگ‌آمیزی با متغیرهای CSS.
 */

import { esc, fa, faNum, faPercent } from './util.js';

/**
 * حلقه امتیاز.
 * @param {number} score ۰ تا ۱۰۰
 * @param {string} color
 * @param {{size?:number, label?:string}} [opts]
 */
export function scoreRing(score, color, opts = {}) {
  const size = opts.size ?? 62;
  const stroke = opts.stroke ?? 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, score)) / 100) * c;

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="امتیاز جذابیت ${esc(score)} از ۱۰۰">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"></circle>
    <circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(color)}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="0"></circle>
  </svg>`;
}

/**
 * نمودار دونات توزیع دسته‌ها.
 * @param {Array<{label:string, value:number, color:string}>} slices
 * @param {{size?:number, centerLabel?:string}} [opts]
 */
export function donut(slices, opts = {}) {
  const size = opts.size ?? 160;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;

  let offset = 0;
  const arcs = slices
    .map((s) => {
      const len = (s.value / total) * c;
      const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${esc(s.color)}" stroke-width="${stroke}"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"
        stroke-linecap="butt"></circle>`;
      offset += len;
      return seg;
    })
    .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
      aria-label="توزیع محصولات در دسته‌ها">${arcs}</svg>`;
}

/**
 * نردبان نرخ‌ها در برابر خط تورم.
 * @param {Array<{label:string, rate:number, note?:string, negative?:boolean}>} rows
 * @param {number|null} inflation
 */
export function rateLadder(rows, inflation) {
  if (!rows?.length) return '<p class="empty-state">داده‌ای برای نمایش نیست.</p>';
  const max = Math.max(30, ...rows.map((r) => r.rate ?? 0), inflation ?? 0);

  const bars = rows
    .map((row) => {
      const pct = Math.max(2, ((row.rate ?? 0) / max) * 100);
      const neg = row.negative === true;
      return `<div class="ladder-row">
        <span class="lbl">${esc(row.label)}</span>
        <span class="ladder-track" title="${esc(row.note || '')}">
          <i class="${neg ? 'negative' : ''}" style="width:${pct.toFixed(1)}%"></i>
        </span>
        <span class="val">${faPercent(row.rate)}</span>
      </div>`;
    })
    .join('');

  const inflationLine =
    inflation != null
      ? `<div class="ladder-row">
          <span class="lbl" style="color:var(--danger)">تورم سالانه</span>
          <span class="ladder-track">
            <i class="negative" style="width:${Math.min(100, (inflation / max) * 100).toFixed(1)}%"></i>
          </span>
          <span class="val" style="color:var(--danger)">${faPercent(inflation)}</span>
        </div>`
      : '';

  return `<div class="ladder">${bars}${inflationLine}</div>`;
}

/**
 * نمودار ستونی افقی مقایسه یک شاخص میان چند محصول.
 * @param {Array<{label:string, value:number, color?:string}>} rows
 * @param {{max?:number, unit?:string}} [opts]
 */
export function compareBars(rows, opts = {}) {
  if (!rows?.length) return '';
  // کف ۱ برای پرهیز از تقسیم بر صفر وقتی همه مقادیر صفرند (NaN در عرض ستون)
  const best = rows.length ? Math.max(...rows.map((r) => Number(r.value) || 0)) : 0;
  const max = Math.max(1, opts.max ?? best);

  return `<div class="ladder">${rows
    .map((row) => {
      const pct = Math.max(1.5, (row.value / max) * 100);
      return `<div class="ladder-row">
        <span class="lbl" title="${esc(row.label)}">${esc(row.label)}</span>
        <span class="ladder-track">
          <i style="width:${pct.toFixed(1)}%;background:${esc(row.color || 'linear-gradient(90deg,var(--brand-dim),var(--brand))')}"></i>
        </span>
        <span class="val">${faNum(row.value)}${opts.unit ? ` ${esc(opts.unit)}` : ''}</span>
      </div>`;
    })
    .join('')}</div>`;
}

/**
 * نقشه حرارتی تازگی داده بر پایه ماه.
 * @param {string[]} dates تاریخ‌های ISO
 * @param {number} months تعداد ماه گذشته برای نمایش
 */
export function freshnessGrid(dates, months = 12) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
    return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, count: 0 };
  });

  for (const iso of dates) {
    const key = String(iso ?? '').slice(0, 7);
    const b = buckets.find((x) => x.key === key);
    if (b) b.count += 1;
  }

  const max = Math.max(1, ...buckets.map((b) => b.count));
  return `<div style="display:flex;gap:3px;align-items:flex-end;height:56px" role="img"
      aria-label="نقشه حرارتی تازگی داده در ${months} ماه گذشته">
    ${buckets
      .map((b) => {
        const h = 8 + (b.count / max) * 46;
        const alpha = 0.18 + (b.count / max) * 0.75;
        return `<span title="${esc(b.key)} — ${fa(b.count)} رکورد"
          style="flex:1;height:${h.toFixed(0)}px;border-radius:4px;
          background:rgba(47,224,168,${alpha.toFixed(2)});
          border:1px solid rgba(255,255,255,.07)"></span>`;
      })
      .join('')}
  </div>`;
}

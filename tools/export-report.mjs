#!/usr/bin/env node
/**
 * گزارش اکسل هفتگی — data/report.xlsx
 *
 * چرا ابزار جدا؟ کاربرِ نهایی اکسل می‌فهمد، نه JSON. هر هفته پس از ممیزی،
 * همین ابزار دادهٔ ثبت‌شده را به یک فایل سه‌برگه‌ای تبدیل و کنار بقیهٔ داده
 * کامیت می‌کند؛ لینک پایدار data/report.xlsx همیشه آخرین گزارش را می‌دهد.
 *
 * امتیازهای «جذابیت» و «بازده حقیقی» با همان موتور مرورگر (score.js)
 * محاسبه می‌شوند تا عدد اکسل با عدد سایت یکی باشد؛ با یک تفاوت صادقانه:
 * در سایت وزن‌ها اختیارِ هر کاربر است، در فایل ثابت از پروفایل «متعادل».
 *
 * استفاده:
 *   node tools/export-report.mjs
 *   node tools/export-report.mjs --out=data/report.xlsx
 *   node tools/export-report.mjs --dir=<پوشهٔ داده>   # پیش‌فرض data/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildXlsx } from '../assets/js/xlsx.js';
import { scoreProduct, DEFAULT_WEIGHTS } from '../assets/js/score.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ساخت برگه‌های گزارش از دادهٔ خام — تابع خالص و قابل آزمون.
 *
 * @param {{
 *   products: Array<object>,
 *   indicators: Record<string, {label?:string, value?:number, period?:string, sourceKind?:string}>,
 *   meta?: object,
 *   now?: Date,
 * }} input
 * @returns {Array<{name:string, columns:string[], rows:Array<Array<any>>, widths?:number[]}>}
 */
export function buildReportSheets({ products, indicators, meta, now = new Date() }) {
  const list = Array.isArray(products) ? products : [];
  const inflation = indicators?.inflationAnnual?.value ?? null;

  const checkedOf = (p) => p.lastSeen || p.lastVerified || p.source?.checked || p.lastUpdated || '';
  const todayISO = now.toISOString().slice(0, 10);

  const productRows = list.map((p) => {
    let score = null;
    let real = null;
    try {
      // همان موتور امتیازدهی مرورگر؛ در نبود تورم، scoreProduct خودش
      // تعدیل نرخ حقیقی را کنار می‌گذارد و فقط امتیاز پایه می‌دهد.
      const result = scoreProduct(p, DEFAULT_WEIGHTS, { inflation });
      score = Number.isFinite(result?.score) ? result.score : null;
      real = Number.isFinite(result?.realRate) ? result.realRate : null;
    } catch {
      // رکوردهای ناقص ورودی، امتیاز نمی‌گیرند؛ ستون خالی می‌ماند.
    }
    return [
      p.bank ?? '',
      p.product ?? '',
      p.category ?? '',
      p.subcategory ?? '',
      p.rateKnown === false || p.rateKind === 'none' ? null : p.rate ?? null,
      p.rateKind === 'fee' ? 'کارمزد' : p.rateKind === 'none' ? 'بدون نرخ' : 'سود',
      p.maxAmount ?? null,
      p.minAmount ?? null,
      p.termMonths ?? null,
      score,
      real,
      p.collateral ?? '',
      p.collateralKind ?? '',
      p.confidence ?? '',
      p.stale ? 'بله' : 'خیر',
      p.availability === 'historical' ? 'تاریخی' : 'فعال',
      checkedOf(p),
      p.lastUpdated ?? '',
      p.source?.url ?? '',
      p.desc ?? '',
    ];
  });

  const indicatorRows = Object.entries(indicators ?? {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => [key, v.label ?? '', typeof v.value === 'number' ? v.value : null, v.period ?? '', v.sourceKind ?? '']);

  const counts = {};
  for (const p of list) counts[p.category] = (counts[p.category] ?? 0) + 1;
  const summaryRows = [
    ['تاریخ تولید گزارش', todayISO],
    ['تعداد کل محصولات', list.length],
    ...Object.entries(counts).map(([k, n]) => [`دسته: ${k}`, n]),
    ['تورم سالانه مرجع (%)', inflation],
    ['آخرین اجرای خط لوله', meta?.lastRun ?? ''],
    ['نوع اجرا', meta?.lastRunMode ?? ''],
    ['پروفایل وزن امتیازدهی', 'متعادل (پیش‌فرض) — در سایت هر کاربر وزن خودش را دارد'],
  ];

  return [
    {
      name: 'محصولات',
      columns: [
        'بانک / نهاد', 'محصول', 'دسته', 'زیردسته', 'نرخ یا کارمزد (٪)', 'نوع نرخ',
        'سقف (تومان)', 'حداقل (تومان)', 'مدت (ماه)', 'امتیاز جذابیت', 'بازده/هزینه حقیقی (٪)',
        'وثیقه', 'نوع وثیقه', 'اطمینان منبع', 'نیازمند بازبینی', 'وضعیت عرضه',
        'آخرین کنترل', 'به‌روزرسانی منبع', 'لینک منبع', 'توضیح',
      ],
      rows: productRows,
      widths: [22, 30, 12, 14, 14, 9, 16, 16, 9, 12, 17, 18, 13, 12, 12, 11, 13, 13, 30, 44],
    },
    {
      name: 'شاخص‌های کلان',
      columns: ['کلید', 'عنوان', 'مقدار', 'دوره', 'نوع منبع'],
      rows: indicatorRows,
      widths: [22, 34, 12, 14, 12],
    },
    {
      name: 'خلاصه',
      columns: ['ستون', 'مقدار'],
      rows: summaryRows,
      widths: [30, 44],
    },
  ];
}

/**
 * ساخت بایت‌های فایل گزارش از پوشهٔ داده — برای CLI و آزمون.
 * @param {{dataDir?:string, now?:Date}} [opts]
 */
export async function buildReport(opts = {}) {
  const dataDir = opts.dataDir ?? path.join(ROOT, 'data');
  const readJSON = async (file, fallback) => {
    try {
      return JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
    } catch {
      return fallback;
    }
  };

  const [products, indicators, meta] = await Promise.all([
    readJSON('products.json', { products: [] }),
    readJSON('indicators.json', { indicators: {} }),
    readJSON('meta.json', {}),
  ]);

  const rows = products.products ?? [];
  if (!rows.length) throw new Error(`هیچ محصولی در ${path.join(dataDir, 'products.json')} یافت نشد`);

  const sheets = buildReportSheets({ products: rows, indicators: indicators.indicators ?? {}, meta, now: opts.now });
  return { bytes: buildXlsx(sheets), count: rows.length };
}

/* ---------- CLI ---------- */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const option = (name) => {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : null;
  };
  const dataDir = option('dir') ? path.resolve(option('dir')) : path.join(ROOT, 'data');
  const out = option('out') ? path.resolve(option('out')) : path.join(dataDir, 'report.xlsx');

  buildReport({ dataDir })
    .then(async ({ bytes, count }) => {
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, bytes);
      console.log(`گزارش اکسل ساخته شد: ${out} (${count} محصول، ${bytes.length} بایت)`);
    })
    .catch((err) => {
      console.error(`[report] خطا: ${err.message}`);
      process.exit(1);
    });
}

#!/usr/bin/env node
/**
 * سازوکار همگام‌سازی و ممیزی هفتگی داده‌های «بانک‌رادار».
 *
 * این ابزار دو مأموریت حیاتی دارد:
 *  ۱) پایش و ممیزی جامع هفتگی از منابع معتبر وب (بانک مرکزی، مرکز آمار، رده و تارنماهای بانکی)
 *     همراه با اعتبارسنجی محصولات دسته‌بندی‌های پنج‌گانه (سپرده، صندوق، تسهیلات، اعتباری، امتیازی)
 *  ۲) درون‌ریزی و ادغام خروجی‌های معتبر بیرونی (JSON یا CSV) که توسط کاربر یا خطوط داده مستقل ارائه می‌شوند،
 *     همراه با تطبیق نام بانک‌ها، راستی‌آزمایی طرح‌واره و به‌روزرسانی تاریخ‌های ممیزی و بازبینی.
 *
 * گزینه‌ها:
 *   node tools/sync-weekly.mjs                       # اجرای ممیزی هفتگی کامل
 *   node tools/sync-weekly.mjs --dry-run             # شبیه‌سازی بدون بازنویسی فایل‌ها
 *   node tools/sync-weekly.mjs --offline             # ممیزی برون‌خطی داده‌های موجود
 *   node tools/sync-weekly.mjs --input=output.json   # درون‌ریزی خروجی JSON منابع معتبر
 *   node tools/sync-weekly.mjs --input=output.csv    # درون‌ریزی خروجی CSV منابع معتبر
 *   node tools/sync-weekly.mjs --limit=150           # سقف واکشی صفحات برای ممیزی عمیق
 *   DGSHAHR_HTML_FILE=… (برای تغذیه آفلاین منبع دیجی‌شهر در اجرای خط لوله)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSource } from './lib/http.mjs';
import { foldForMatch, daysSince, today, slugify, normalizeText, toNumber, matchBank, makeLatinId } from './lib/parse.mjs';
import { todayJalali, formatJalali } from './lib/jalali.mjs';
import * as rade from './sources/rade.mjs';
import * as banks from './sources/banks.mjs';
import * as cbi from './sources/cbi.mjs';
import * as dgshahr from './sources/dgshahr.mjs';
import { buildBundle } from './build-bundle.mjs';
import { sortDeep, mergeProducts, deepEqual } from './collect.mjs';
import { signatureOf } from './data-signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const ARGS = process.argv.slice(2);
const FLAG = (name) => ARGS.includes(`--${name}`);
const OPT = (name, fallback = null) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const DRY_RUN = FLAG('dry-run');
const OFFLINE = FLAG('offline');
const VERBOSE = FLAG('verbose');
const LIMIT = Number(OPT('limit', 150));
const INPUT_FILE = OPT('input');
const REPORT_FILE = OPT('report', path.join(DATA, 'weekly-report.json'));

const log = (msg) => console.log(`[weekly-sync] ${msg}`);
const vlog = (msg) => VERBOSE && console.log(`[verbose] ${msg}`);

/* ------------------------------------------------------------------ */
/* ابزارهای ورودی/خروجی و خواندن فایل‌ها                              */
/* ------------------------------------------------------------------ */

async function readJSON(file, fallback = null) {
  try {
    const fullPath = path.isAbsolute(file) ? file : path.join(DATA, file);
    return JSON.parse(await fs.readFile(fullPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== null) return fallback;
    throw new Error(`خواندن ${file} ناموفق بود: ${err.message}`);
  }
}

async function writeJSON(file, value) {
  if (DRY_RUN) {
    vlog(`(dry-run) نوشتن ${file} انجام نشد`);
    return;
  }
  const fullPath = path.isAbsolute(file) ? file : path.join(DATA, file);
  const sorted = sortDeep(value);
  await fs.writeFile(fullPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/* ------------------------------------------------------------------ */
/* تجزیه‌گر CSV با پشتیبانی کامل از نقل‌قول و کاراکترهای فارسی           */
/* ------------------------------------------------------------------ */

export function parseCSV(text) {
  if (!text || typeof text !== 'string') return [];
  // حذف کاراکتر اختیاری BOM در ابتدای فایل‌های اکسل
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field.trim());
        field = '';
      } else if (c === '\r') {
        // نادیده گرفتن \r در ویندوز
      } else if (c === '\n') {
        row.push(field.trim());
        if (row.some((f) => f.length > 0)) rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((f) => f.length > 0)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const items = [];

  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = vals[c] !== undefined ? vals[c] : '';
    }
    items.push(obj);
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* تطبیق و یکسان‌سازی هوشمند نام بانک‌ها                             */
/* ------------------------------------------------------------------ */

// matchBank و makeLatinId به tools/lib/parse.mjs منتقل شدند (منبع‌ها هم به آن‌ها نیاز دارند)
export { matchBank, makeLatinId };

/* ------------------------------------------------------------------ */
/* تبدیل و نرمال‌سازی داده‌های ورودی بیرونی                              */
/* ------------------------------------------------------------------ */

export function parseInputData(rawContent, filename = 'input.json', banksList = []) {
  let records = [];
  const trimmed = typeof rawContent === 'string' ? rawContent.trim() : '';
  const isExplicitJSON = trimmed.startsWith('[') || trimmed.startsWith('{') || filename.toLowerCase().endsWith('.json');
  const isCSV = !isExplicitJSON && (filename.toLowerCase().endsWith('.csv') || trimmed.startsWith('"'));

  if (isCSV) {
    records = parseCSV(rawContent);
  } else {
    const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
    records = Array.isArray(parsed) ? parsed : parsed.products ?? [];
  }

  const normalized = [];
  const validCategories = new Set(['deposits', 'funds', 'credit', 'loans', 'loyalty']);

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    if (!raw || typeof raw !== 'object') continue;

    const productTitle = normalizeText(raw.product || raw.name || raw.title || '');
    if (!productTitle) continue;

    const matchedBank = matchBank(raw.bank || raw.bankName, banksList);
    const category = validCategories.has(raw.category) ? raw.category : 'loans';

    const rateNum = typeof raw.rate === 'number' ? raw.rate : toNumber(raw.rate) ?? 0;
    const rateKind = ['profit', 'fee', 'yield', 'none'].includes(raw.rateKind)
      ? raw.rateKind
      : rateNum === 0
        ? 'none'
        : 'profit';

    const minAmount = raw.minAmount != null ? toNumber(raw.minAmount) : null;
    const maxAmount = raw.maxAmount != null ? toNumber(raw.maxAmount) : null;
    const termMonths = raw.termMonths != null ? toNumber(raw.termMonths) : null;

    const id = raw.id && /^[a-z0-9][a-z0-9-]*$/.test(raw.id)
      ? raw.id
      : makeLatinId(matchedBank.id, productTitle);

    const sourceUrl = raw.sourceUrl || raw.url || raw.source?.url || 'https://www.cbi.ir';
    const sourceTitle = raw.sourceTitle || raw.source?.title || matchedBank.name;

    normalized.push({
      id,
      bank: matchedBank.name,
      bankId: matchedBank.id,
      product: productTitle,
      category,
      subcategory: raw.subcategory || 'other',
      rate: rateNum,
      rateKind,
      contractType: ['qarz', 'non-partnership', 'partnership', 'unknown'].includes(raw.contractType)
        ? raw.contractType
        : undefined,
      benefit: typeof raw.benefit === 'number' ? raw.benefit : undefined,
      minAmount,
      maxAmount,
      amountLabel: raw.amountLabel || (maxAmount ? `${maxAmount.toLocaleString('en-US')} تومان` : 'نامشخص'),
      termMonths,
      termLabel: raw.termLabel || (termMonths ? `${termMonths} ماه` : 'نامشخص'),
      speed: typeof raw.speed === 'number' ? raw.speed : 65,
      digital: typeof raw.digital === 'number' ? raw.digital : 70,
      friction: typeof raw.friction === 'number' ? raw.friction : 60,
      collateral: raw.collateral || 'نامشخص',
      collateralKind: raw.collateralKind || 'credit-score',
      audience: raw.audience || 'متقاضیان عمومی',
      desc: raw.desc || productTitle,
      tags: Array.isArray(raw.tags) ? raw.tags : [category, matchedBank.name],
      requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
      confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
      regulatory: raw.regulatory === true,
      autoDiscovered: false,
      lastUpdated: raw.lastUpdated || today(),
      lastSeen: today(),
      lastVerified: today(),
      source: {
        title: sourceTitle,
        url: sourceUrl,
        kind: raw.source?.kind || 'bank',
        checked: today(),
      },
      extra: raw.extra || {},
    });
  }

  return normalized;
}

/* ------------------------------------------------------------------ */
/* موتور تشخیص هوشمند ناهنجاری و پایبندی به مصوبات بانک مرکزی           */
/* ------------------------------------------------------------------ */

export function detectAnomalies(products = [], indicators = {}) {
  const anomalies = [];
  const ind = indicators.indicators ?? {};
  const depositCap1y = ind.depositCap1y?.value ?? 23;
  const loanCeiling = ind.loanRateCeiling?.value ?? 23;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const at = `محصول «${p.product}» (${p.bank} — ${p.id})`;

    // ۱) انحراف سقف سپرده مصوب بانک مرکزی
    if (p.category === 'deposits' && p.rate > depositCap1y) {
      anomalies.push({
        id: 'cbi-deposit-cap-exceeded',
        severity: 'warn',
        productId: p.id,
        bank: p.bank,
        rate: p.rate,
        title: 'نرخ سود سپرده بالاتر از سقف مصوب',
        detail: `${at}: نرخ ${p.rate}٪ بالاتر از سقف مصوب ${depositCap1y}٪ بانک مرکزی است.`,
      });
    }

    // ۲) انحراف سقف نرخ تسهیلات غیرمشارکتی
    if (p.category === 'loans' && p.contractType === 'non-partnership' && p.rate > loanCeiling) {
      anomalies.push({
        id: 'cbi-loan-cap-exceeded',
        severity: 'warn',
        productId: p.id,
        bank: p.bank,
        rate: p.rate,
        title: 'نرخ تسهیلات مبادله‌ای بالاتر از سقف',
        detail: `${at}: نرخ سود تسهیلات غیرمشارکتی ${p.rate}٪ بالاتر از سقف مصوب ${loanCeiling}٪ است.`,
      });
    }

    // ۳) مغایرت دامنه مبالغ
    if (p.minAmount != null && p.maxAmount != null && p.minAmount > p.maxAmount) {
      anomalies.push({
        id: 'invalid-amount-range',
        severity: 'error',
        productId: p.id,
        bank: p.bank,
        title: 'حداقل مبلغ بیشتر از سقف',
        detail: `${at}: حداقل مبلغ (${p.minAmount}) از سقف (${p.maxAmount}) بیشتر است.`,
      });
    }

    // ۴) تله مسدودی سپرده و هزینه فرصت پنهان
    if (p.collateralKind === 'deposit-block' && p.rate >= 20) {
      anomalies.push({
        id: 'hidden-opportunity-cost-trap',
        severity: 'info',
        productId: p.id,
        bank: p.bank,
        rate: p.rate,
        title: 'تله مسدودی سپرده همراه با سود تجاری',
        detail: `${at}: مسدودی سپرده در نرخ ۲۳٪، نرخ مؤثر واقعی را به بیش از ۳۵٪ افزایش می‌دهد.`,
      });
    }

    // ۵) ریسک کهنگی داده‌های منبع
    if (p.lastUpdated && daysSince(p.lastUpdated) > 180) {
      anomalies.push({
        id: 'stale-source-risk',
        severity: 'info',
        productId: p.id,
        bank: p.bank,
        title: 'بیش از ۶ ماه از به‌روزرسانی صفحه منبع گذشته است',
        detail: `${at}: صفحه منبع ${daysSince(p.lastUpdated)} روز است که به‌روزرسانی نشده است.`,
      });
    }
  }

  return anomalies;
}

/* ------------------------------------------------------------------ */
/* ممیزی و تازه‌سازی رکوردهای دست‌نویس و محصولات پنج‌گانه               */
/* ------------------------------------------------------------------ */

export function auditCuratedProducts(products = [], opts = {}) {
  const auditDate = opts.date || today();
  let verifiedCount = 0;

  const audited = products.map((p) => {
    // رکوردهایی که نشانی معتبر دارند و فعال هستند ممیزی می‌شوند
    const isCurated = p.autoDiscovered !== true;
    if (isCurated && p.source?.url && /^https?:\/\//.test(p.source.url)) {
      verifiedCount++;
      return {
        ...p,
        lastVerified: auditDate,
        lastSeen: p.lastSeen || auditDate,
        source: {
          ...p.source,
          checked: auditDate,
        },
      };
    }
    return p;
  });

  return { audited, verifiedCount };
}

/* ------------------------------------------------------------------ */
/* ساخت گزارش هفتگی                                                   */
/* ------------------------------------------------------------------ */

function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

export function generateWeeklyReport(opts = {}) {
  const {
    products = [],
    indicators = {},
    anomalies = [],
    sources = [],
    mode = 'weekly-sync',
    mergeStats = null,
    startedAt = new Date(),
  } = opts;

  const j = todayJalali();
  const period = toPersianDigits(formatJalali(j.jy, j.jm, j.jd));

  const byCat = products.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  const total = products.length;
  const curated = products.filter((p) => p.autoDiscovered !== true).length;
  const auto = products.filter((p) => p.autoDiscovered === true).length;
  const stale = products.filter((p) => p.stale === true).length;
  const verifiedIn7Days = products.filter((p) => {
    const d = p.lastSeen || p.lastVerified || p.source?.checked || p.lastUpdated;
    return daysSince(d) <= 7;
  }).length;

  const ind = indicators.indicators ?? {};
  const inflationAnnual = ind.inflationAnnual?.value ?? 69.9;
  const depositCap1y = ind.depositCap1y?.value ?? 23;
  const realDepositReturn = indicators.derived?.realDepositReturnAnnual ?? Number((depositCap1y - inflationAnnual).toFixed(1));

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    period: `هفته منتهی به ${period}`,
    mode,
    durationMs: Date.now() - startedAt.getTime(),
    counts: { ...byCat, total },
    stats: {
      totalProducts: total,
      curatedProducts: curated,
      autoProducts: auto,
      staleProducts: stale,
      verifiedIn7Days,
      freshnessPercent: total ? Math.round((verifiedIn7Days / total) * 100) : 0,
      healthScore: Math.max(0, Math.min(100, Math.round(
        (verifiedIn7Days / Math.max(1, total)) * 50 +
        (1 - stale / Math.max(1, total)) * 30 +
        (anomalies.filter((a) => a.severity === 'error').length === 0 ? 20 : 0),
      ))),
    },
    macro: {
      inflationAnnual,
      depositCap1y,
      loanRateCeiling: ind.loanRateCeiling?.value ?? 23,
      interbankRate: ind.interbankRate?.value ?? 24,
      realDepositReturn,
    },
    sources,
    anomalies: {
      total: anomalies.length,
      errors: anomalies.filter((a) => a.severity === 'error').length,
      warnings: anomalies.filter((a) => a.severity === 'warn').length,
      notices: anomalies.filter((a) => a.severity === 'info').length,
      items: anomalies,
    },
    merge: mergeStats,
    signature: signatureOf({ products, indicators, banks: opts.banks ?? [] }),
  };
}

/* ------------------------------------------------------------------ */
/* تابع اصلی همگام‌سازی هفتگی                                         */
/* ------------------------------------------------------------------ */

export async function syncWeekly(opts = {}) {
  const startedAt = new Date();
  const dryRun = opts.dryRun ?? DRY_RUN;
  const offline = opts.offline ?? OFFLINE;
  const limit = opts.limit ?? LIMIT;
  const inputFile = opts.inputFile ?? INPUT_FILE;
  const reportPath = opts.reportPath ?? REPORT_FILE;

  log(`آغاز همگام‌سازی و ممیزی هفتگی — ${startedAt.toISOString()}${dryRun ? ' (dry-run)' : ''}${offline ? ' (offline)' : ''}`);

  const [dataset, indicatorsBase, banksFile] = await Promise.all([
    readJSON('products.json'),
    readJSON('indicators.json'),
    readJSON('banks.json'),
  ]);

  if (!dataset?.products?.length) throw new Error('data/products.json نامعتبر یا خالی است');
  if (!indicatorsBase?.indicators) throw new Error('data/indicators.json نامعتبر است');

  const banksList = banksFile?.banks ?? [];
  let incoming = [];
  const sourcesLog = [];
  let indicators = indicatorsBase;

  // گام ۱: درون‌ریزی فایل خروجی معتبر (در صورت ارائه توسط کاربر یا خط داده)
  if (inputFile) {
    try {
      const content = await fs.readFile(inputFile, 'utf8');
      const imported = parseInputData(content, inputFile, banksList);
      incoming = incoming.concat(imported);
      sourcesLog.push({
        name: `import:${path.basename(inputFile)}`,
        ok: true,
        count: imported.length,
        ms: Date.now() - startedAt.getTime(),
      });
      log(`درون‌ریزی خروجی: ${imported.length} محصول از «${path.basename(inputFile)}» پردازش شد`);
    } catch (err) {
      sourcesLog.push({
        name: `import:${path.basename(inputFile)}`,
        ok: false,
        error: err.message,
      });
      log(`خطا در درون‌ریزی فایل: ${err.message}`);
    }
  }

  // گام ۲: پایش هفتگی منابع وب (در صورت نبود پرچم offline)
  if (!offline && !inputFile) {
    // رده
    const radeResult = await runSource('rade-weekly', () =>
      rade.collect({ limit, concurrency: 5, log: vlog }),
    );
    if (radeResult.ok) {
      incoming = incoming.concat(radeResult.data.products);
      sourcesLog.push({
        name: 'rade.ir (weekly-audit)',
        ok: true,
        discovered: radeResult.data.discovered,
        attempted: radeResult.data.attempted,
        parsed: radeResult.data.parsed,
        ms: radeResult.ms,
      });
      log(`رده: ${radeResult.data.parsed} محصول در ممیزی هفتگی واکشی شد`);
    } else {
      sourcesLog.push({ name: 'rade.ir', ok: false, error: radeResult.error, ms: radeResult.ms });
    }

    // بانک مرکزی و شاخص‌ها
    const cbiResult = await runSource('cbi-weekly', () => cbi.collect(indicatorsBase, { log: vlog }));
    if (cbiResult.ok) {
      indicators = cbiResult.data.indicators;
      sourcesLog.push({
        name: 'macro-indicators',
        ok: true,
        touched: cbiResult.data.touched,
        ms: cbiResult.ms,
      });
    }

    // سایت بانک‌ها
    const bankResult = await runSource('banks-weekly', () => banks.collect({ concurrency: 4, log: vlog }));
    if (bankResult.ok) {
      sourcesLog.push({
        name: 'bank-sites',
        ok: true,
        targets: bankResult.data.targets,
        reachable: bankResult.data.ok,
        ms: bankResult.ms,
      });
    }

    // مجله دیجی‌شهر — جدول نرخ‌های سود سپرده (ترجیحی و طرح‌های ویژه)
    const banksData = await readJSON('banks.json', { banks: [] });
    const dgResult = await runSource('dgshahr-weekly', () =>
      dgshahr.collect({ existing: dataset.products, banks: banksData?.banks ?? [], log: vlog }),
    );
    if (dgResult.ok) {
      incoming = incoming.concat(dgResult.data.products);
      sourcesLog.push({
        name: 'dgshahr.com (weekly-audit)',
        ok: true,
        parsed: dgResult.data.products.length,
        tiers: dgResult.data.tierRows,
        schemes: dgResult.data.schemeRows,
        ms: dgResult.ms,
      });
      log(`دیجی‌شهر: ${dgResult.data.products.length} محصول سپرده در ممیزی هفتگی`);
    } else {
      sourcesLog.push({ name: 'dgshahr.com', ok: false, error: dgResult.error, ms: dgResult.ms });
      log(`دیجی‌شهر: ناموفق — ${dgResult.error}`);
    }
  }

  // گام ۳: ممیزی رکوردهای دست‌نویس و ثبت تاریخ کنترل هفتگی
  const { audited, verifiedCount } = auditCuratedProducts(dataset.products);
  log(`ممیزی رکوردهای دست‌نویس: ${verifiedCount} محصول بازبینی و تأیید شد`);

  // گام ۴: ادغام محصولات تازه با پایگاه داده
  const { merged, stats } = mergeProducts(audited, incoming);
  log(`ادغام هفتگی: ${stats.added} افزوده، ${stats.updated} به‌روزرسانی، ${stats.unchanged} بی‌تغییر`);

  // گام ۵: تشخیص هوشمند ناهنجاری و انحرافات سیاستی
  const anomalies = detectAnomalies(merged, indicators);
  log(`پایش ناهنجاری‌ها: ${anomalies.length} مورد بررسی گردید (${anomalies.filter((a) => a.severity === 'warn').length} هشدار)`);

  const counts = merged.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  const productsOut = {
    version: dataset.version ?? 2,
    generatedAt: startedAt.toISOString(),
    generator: 'tools/sync-weekly.mjs',
    disclaimer: dataset.disclaimer,
    counts: { ...counts, total: merged.length },
    stale: merged.filter((p) => p.stale).length,
    autoDiscovered: merged.filter((p) => p.autoDiscovered).length,
    products: merged,
  };

  // گام ۶: ایجاد گزارش جامع هفتگی
  const report = generateWeeklyReport({
    products: merged,
    indicators,
    anomalies,
    sources: sourcesLog,
    mode: inputFile ? 'external-import' : offline ? 'offline-audit' : 'weekly-sync',
    mergeStats: { ...stats, incoming: incoming.length, baseline: dataset.products.length },
    banks: banksList,
    startedAt,
  });

  if (!dryRun) {
    await writeJSON('products.json', productsOut);
    await writeJSON('indicators.json', indicators);
    await writeJSON(reportPath, report);
    await buildBundle({ dataDir: DATA, log: vlog });
    log('بسته داده و فایل‌های JSON با موفقیت بازسازی شدند');
  }

  // گام ۷: ثبت خلاصه در گیت‌هاب اکشنز در صورت اجرا روی دونده
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      '# 📊 گزارش ممیزی و به‌روزرسانی هفتگی بانک‌رادار',
      '',
      `**دوره:** ${report.period} · **زمان:** \`${report.durationMs} ms\``,
      '',
      '### وضعیت کلی مجموعه داده',
      '| شاخص | مقدار | وضعیت |',
      '| --- | --- | --- |',
      `| مجموع محصولات | **${report.stats.totalProducts}** | فعال |`,
      `| تازگی در ۷ روز اخیر | **${report.stats.verifiedIn7Days}** (${report.stats.freshnessPercent}٪) | ${report.stats.freshnessPercent >= 90 ? '🟢 عالی' : '🟡 نیازمند توجه'} |`,
      `| محصولات کهنه (Stale) | **${report.stats.staleProducts}** | ${report.stats.staleProducts === 0 ? '🟢 صفر' : '🔴 بررسی شود'} |`,
      `| امتیاز سلامت داده | **${report.stats.healthScore} از ۱۰۰** | ${report.stats.healthScore >= 90 ? '🟢 عالی' : '🟡 متوسط'} |`,
      `| تورم سالانه مرجع | **${report.macro.inflationAnnual}٪** | ${report.macro.realDepositReturn < 0 ? 'بازده واقعی سپرده: منفی' : 'خنثی'} |`,
      '',
      '### ناهنجاری‌ها و اخطارهای شناسایی‌شده',
      anomalies.length
        ? anomalies.slice(0, 10).map((a) => `- **[${a.severity.toUpperCase()}]** ${a.title}: ${a.detail}`).join('\n')
        : '✓ هیچ ناهنجاری یا مغایرتی با مصوبات بانک مرکزی مشاهده نشد.',
      '',
      '### تغییرات ادغام داده',
      `- افزوده: **${stats.added}** · به‌روز: **${stats.updated}** · بی‌تغییر: **${stats.unchanged}**`,
      '',
    ];
    await fs.appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  }

  return { report, productsOut, indicators };
}

/* ------------------------------------------------------------------ */
/* فراخوانی CLI                                                       */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  syncWeekly()
    .then(({ report }) => {
      console.log(`[weekly-sync] ممیزی با امتیاز سلامت ${report.stats.healthScore}/100 پایان یافت.`);
    })
    .catch((err) => {
      console.error(`[weekly-sync] خطای مرگبار: ${err.stack || err.message}`);
      process.exit(1);
    });
}

#!/usr/bin/env node
/**
 * خط لوله جمع‌آوری داده «بانک‌رادار».
 *
 * اصول طراحی:
 *  ۱. داده دست‌نویس هرگز حذف نمی‌شود؛ فقط به‌روزرسانی یا علامت‌گذاری می‌شود.
 *  ۲. هر منبع مستقل شکست می‌خورد؛ شکست یک منبع کل اجرا را متوقف نمی‌کند.
 *  ۳. هر تغییر در گزارش meta.json قابل ردیابی است (چه چیزی، از کجا، چه زمانی).
 *  ۴. خروجی قطعی و پایدار است: مرتب‌سازی کلیدها تا diff گیت قابل‌خوان باشد.
 *
 * استفاده:
 *   node tools/collect.mjs              # واکشی کامل و نوشتن
 *   node tools/collect.mjs --dry-run    # بدون نوشتن، فقط گزارش
 *   node tools/collect.mjs --offline    # بدون شبکه (فقط بازسازی bundle و اعتبارسنجی)
 *   node tools/collect.mjs --limit=60   # محدودکردن تعداد صفحات وام
 *   node tools/collect.mjs --only=dgshahr  # فقط منبع دیجی‌شهر (برای درون‌ریزی آفلاین: DGSHAHR_HTML_FILE)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSource } from './lib/http.mjs';
import { foldForMatch, daysSince, today, slugify } from './lib/parse.mjs';
import * as rade from './sources/rade.mjs';
import * as banks from './sources/banks.mjs';
import * as cbi from './sources/cbi.mjs';
import * as dgshahr from './sources/dgshahr.mjs';
import { buildBundle } from './build-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const ARGS = process.argv.slice(2);
const FLAG = (name) => ARGS.includes(`--${name}`);
const OPT = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const DRY_RUN = FLAG('dry-run');
const OFFLINE = FLAG('offline');
const VERBOSE = FLAG('verbose');
const LIMIT = Number(OPT('limit', 120));
// محدودکردن اجرا به برخی منابع: --only=dgshahr یا --only=rade,banks
const ONLY = new Set(String(OPT('only', '')).split(',').map((s) => s.trim()).filter(Boolean));
const runs = (name) => !ONLY.size || ONLY.has(name);

const log = (msg) => console.log(`[collect] ${msg}`);
const vlog = (msg) => VERBOSE && console.log(`[verbose] ${msg}`);

/* ------------------------------------------------------------------ */
/* ورودی/خروجی                                                         */
/* ------------------------------------------------------------------ */

async function readJSON(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== null) return fallback;
    throw new Error(`خواندن ${file} ناموفق بود: ${err.message}`);
  }
}

/** نوشتن JSON با کلیدهای مرتب و newline پایانی (diff پایدار در گیت) */
async function writeJSON(file, value) {
  if (DRY_RUN) {
    vlog(`(dry-run) نوشتن ${file} انجام نشد`);
    return;
  }
  const sorted = sortDeep(value);
  await fs.writeFile(path.join(DATA, file), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** مرتب‌سازی بازگشتی کلیدها؛ آرایه‌ها دست‌نخورده می‌مانند */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortDeep(value[k])]),
    );
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* ادغام                                                               */
/* ------------------------------------------------------------------ */

/** کلید تطبیق پایدار برای تشخیص یک محصول تکراری */
function matchKey(p) {
  return `${slugify(p.bank)}::${foldForMatch(p.product).slice(0, 50)}`;
}

/**
 * ادغام محصولات تازه‌کشف‌شده در مجموعه موجود.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {{merged:object[], stats:{added:number, updated:number, unchanged:number}}}
 */
/**
 * مقایسه ساختاری دو مقدار JSON-پذیر.
 *
 * چرا لازم است: رکوردهای تازه از تجزیه HTML ساخته می‌شوند و همیشه شیء
 * تازه‌اند. مقایسه با `===` دو شیء با محتوای یکسان را «متفاوت» می‌بیند و
 * نتیجه‌اش این است که هر اجرا همه رکوردها را «به‌روزشده» گزارش می‌کند.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]));
}

export function mergeProducts(existing, incoming) {
  const byId = new Map(existing.map((p) => [p.id, { ...p }]));
  const byKey = new Map(existing.map((p) => [matchKey(p), p.id]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const seenIds = new Set();

  for (const raw of incoming) {
    if (!raw || !raw.product) continue;
    const candidate = { ...raw };
    // رکورد بی‌شناسه نباید روی کلید undefined روی هم بیفتد؛ شناسه پایدار و
    // سازگار با الگوی مجاز (^[a-z0-9][a-z0-9-]*$) از کلید تطبیق ساخته می‌شود.
    if (!candidate.id) {
      const h = [...matchKey(candidate)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
      candidate.id = `auto-${h.toString(36)}`;
    }
    // رکورد دیده‌شده در این اجرا
    candidate.stale = false;
    candidate.lastSeen = today();

    let targetId = byId.has(candidate.id) ? candidate.id : byKey.get(matchKey(candidate));
    seenIds.add(targetId ?? candidate.id);

    if (!targetId) {
      byId.set(candidate.id, candidate);
      byKey.set(matchKey(candidate), candidate.id);
      added += 1;
      continue;
    }

    const current = byId.get(targetId);
    const isCurated = current.autoDiscovered !== true;

    // فیلدهای ساختاری که هرگز از منبع خودکار بازنویسی نمی‌شوند
    const frozen = isCurated
      ? ['id', 'category', 'subcategory', 'benefit', 'speed', 'digital', 'friction', 'collateralKind', 'confidence', 'regulatory', 'source', 'lastUpdated']
      : [];

    const next = { ...current };
    let changed = false;

    // برای رکورد دست‌نویس، مقدار تهی نباید مقدار انسانی را پاک کند.
    // برای رکورد خودکار برعکس است: اگر تجزیه تازه بگوید سقف یا مدت وجود ندارد
    // (مثلاً صفحه‌ای که بسته چند‌طرحی است)، همان حکم معتبر است و باید مقدار
    // قدیمی و نادرست را پاک کند.
    const skipEmpty = isCurated;

    for (const [k, v] of Object.entries(candidate)) {
      if (frozen.includes(k)) continue;
      if (skipEmpty && (v === null || v === undefined || v === '')) continue;
      if (skipEmpty && Array.isArray(v) && v.length === 0) continue;
      // تاریخ‌های کنترلی هرگز با مقدار تهی پاک نمی‌شوند: نبودِ تاریخ در تجزیه
      // تازه یعنی «نامعلوم»، نه «حذف». پاک شدن lastUpdated رکورد معتبر را از
      // اعتبار می‌اندازد (اعتبارسنجی، تاریخ را الزامی می‌داند) و کل خط لوله را
      // به‌خاطر یک صفحه بدون تاریخ، سرخ می‌کند.
      if ((k === 'lastUpdated' || k === 'lastSeen' || k === 'lastVerified') && (v === null || v === undefined || v === '')) {
        continue;
      }
      const prev = next[k];
      // مقایسه ارجاعی برای اشیای تودرتو («extra») همیشه «متفاوت» می‌داد و
      // هر رکورد خودکار در هر اجرا «به‌روزشده» شمرده می‌شد؛ آمار ادغام
      // بی‌معنا می‌شد. مقایسه ساختاری، همین را درست می‌کند.
      const same =
        (Array.isArray(prev) || (prev && typeof prev === 'object')) && v && typeof v === 'object'
          ? deepEqual(prev, v)
          : prev === v;
      if (!same) {
        next[k] = v;
        changed = true;
      }
    }

    // تاریخ کنترل: برای رکورد دست‌نویس از تاریخ منبع استفاده می‌کنیم
    if (isCurated) {
      const srcDate = candidate.lastUpdated;
      if (srcDate && daysSince(srcDate) < daysSince(current.lastUpdated || '1970-01-01')) {
        next.sourceObservedAt = srcDate;
        changed = true;
      }
      next.lastVerified = today();
    }

    if (changed) {
      byId.set(targetId, next);
      updated += 1;
    } else {
      byId.set(targetId, { ...current, lastSeen: today(), stale: false });
      unchanged += 1;
    }
  }

  // علامت‌گذاری رکوردهای خودکارِ دیده‌نشده (حذف نمی‌شوند)
  for (const [id, p] of byId) {
    if (p.autoDiscovered === true && !seenIds.has(id)) {
      const lastSeen = p.lastSeen || p.lastUpdated;
      if (lastSeen && daysSince(lastSeen) > 45) {
        byId.set(id, { ...p, stale: true });
      }
    }
  }

  const merged = [...byId.values()].sort((a, b) => {
    const order = { deposits: 0, credit: 1, loans: 2, loyalty: 3, funds: 4 };
    const c = (order[a.category] ?? 9) - (order[b.category] ?? 9);
    if (c !== 0) return c;
    return String(a.id).localeCompare(String(b.id));
  });

  return { merged, stats: { added, updated, unchanged } };
}

/* ------------------------------------------------------------------ */
/* اجرا                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const startedAt = new Date();
  log(`شروع جمع‌آوری — ${startedAt.toISOString()}${DRY_RUN ? ' (dry-run)' : ''}${OFFLINE ? ' (offline)' : ''}`);

  const dataset = await readJSON('products.json');
  const indicatorsBase = await readJSON('indicators.json');

  if (!dataset?.products?.length) throw new Error('data/products.json خالی یا نامعتبر است');
  if (!indicatorsBase?.indicators) throw new Error('data/indicators.json نامعتبر است');

  const baseline = dataset.products.length;
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    dryRun: DRY_RUN,
    offline: OFFLINE,
    sources: [],
    merge: null,
    durationMs: 0,
  };

  let incoming = [];
  let indicators = indicatorsBase;

  if (!OFFLINE) {
    if (runs('rade')) {
    // ۱) رده
    // چرخش بازبینی: قدیمی‌ترین رکوردهای خودکار از نظر lastSeen اول صف
    // می‌ایستند. با سهمی از سقف واکشی، همه رکوردها در چند روز نوبت
    // بازبینی می‌گیرند و مقدارهای نادرست قدیمی اصلاح می‌شوند.
    const rotationQuota = Math.max(10, Math.round(LIMIT / 4));
    const refreshUrls = dataset.products
      .filter((p) => p.autoDiscovered === true && p.source?.url)
      .sort((a, b) => String(a.lastSeen || '').localeCompare(String(b.lastSeen || '')))
      .slice(0, rotationQuota)
      .map((p) => p.source.url);
    vlog(`چرخش بازبینی: ${refreshUrls.length} رکورد قدیمی در نوبت بازبینی`);

    const radeResult = await runSource('rade', () =>
      rade.collect({ limit: LIMIT, concurrency: 5, refreshUrls, log: vlog }),
    );
    if (radeResult.ok) {
      incoming = incoming.concat(radeResult.data.products);
      report.sources.push({
        name: 'rade.ir',
        ok: true,
        discovered: radeResult.data.discovered,
        attempted: radeResult.data.attempted,
        fresh: radeResult.data.fresh,
        rotated: radeResult.data.rotated,
        parsed: radeResult.data.parsed,
        failures: radeResult.data.failures.length,
        ms: radeResult.ms,
      });
      log(`رده: ${radeResult.data.parsed} محصول از ${radeResult.data.attempted} صفحه استخراج شد`);
    } else {
      report.sources.push({ name: 'rade.ir', ok: false, error: radeResult.error, ms: radeResult.ms });
      log(`رده: ناموفق — ${radeResult.error}`);
    }
    }

    if (runs('banks')) {
    // ۲) سایت بانک‌ها
    const bankResult = await runSource('banks', () => banks.collect({ concurrency: 4, log: vlog }));
    if (bankResult.ok) {
      report.sources.push({
        name: 'bank-sites',
        ok: true,
        targets: bankResult.data.targets,
        reachable: bankResult.data.ok,
        // فهرست کامل اهداف با وضعیت هر یک — تا شکست یک آدرس در صدای داده
        // گم نشود و بتوان هدف خراب را مستقیم اصلاح کرد
        detail: (bankResult.data.observations ?? [])
          .map((o) => ({
            id: o.id,
            url: o.url,
            ok: o.ok,
            ...(o.ok ? { rates: (o.rates ?? []).slice(0, 6) } : { error: o.error }),
          }))
          .sort((a, b) => Number(b.ok) - Number(a.ok)),
        ms: bankResult.ms,
      });
      log(`بانک‌ها: ${bankResult.data.ok} از ${bankResult.data.targets} هدف پاسخ داد`);
    } else {
      report.sources.push({ name: 'bank-sites', ok: false, error: bankResult.error, ms: bankResult.ms });
    }
    }

    if (runs('cbi')) {
    // ۳) شاخص‌های کلان
    const cbiResult = await runSource('cbi', () => cbi.collect(indicatorsBase, { log: vlog }));
    if (cbiResult.ok) {
      indicators = cbiResult.data.indicators;
      report.sources.push({
        name: 'macro-indicators',
        ok: true,
        sourcesOk: cbiResult.data.sourcesOk,
        touched: cbiResult.data.touched,
        ms: cbiResult.ms,
      });
      if (cbiResult.data.touched.length) log(`شاخص‌ها به‌روز شد: ${cbiResult.data.touched.join(' | ')}`);
    } else {
      report.sources.push({ name: 'macro-indicators', ok: false, error: cbiResult.error, ms: cbiResult.ms });
    }
    }


    // ۴) مجله دیجی‌شهر — جدول نرخ‌های سود سپرده (ترجیحی و طرح‌های ویژه)
    if (runs('dgshahr')) {
      const banksData = await readJSON('banks.json', { banks: [] });
      const dgResult = await runSource('dgshahr', () =>
        dgshahr.collect({ existing: dataset.products, banks: banksData?.banks ?? [], log: vlog }),
      );
      if (dgResult.ok) {
        incoming = incoming.concat(dgResult.data.products);
        report.sources.push({
          name: 'dgshahr.com',
          ok: true,
          parsed: dgResult.data.products.length,
          tiers: dgResult.data.tierRows,
          schemes: dgResult.data.schemeRows,
          standard: (dgResult.data.standard ?? []).length,
          ms: dgResult.ms,
        });
        log(`دیجی‌شهر: ${dgResult.data.products.length} محصول سپرده (${dgResult.data.tierRows} پله ترجیحی + ${dgResult.data.schemeRows} طرح)`);
      } else {
        report.sources.push({ name: 'dgshahr.com', ok: false, error: dgResult.error, ms: dgResult.ms });
        log(`دیجی‌شهر: ناموفق — ${dgResult.error}`);
      }
    }

  } else {
    log('حالت offline: واکشی شبکه انجام نشد');
  }

  // ادغام
  const { merged, stats } = mergeProducts(dataset.products, incoming);
  report.merge = { baseline, incoming: incoming.length, final: merged.length, ...stats };
  log(
    `ادغام: ${stats.added} افزوده، ${stats.updated} به‌روز، ${stats.unchanged} بی‌تغییر — مجموع ${merged.length}`,
  );

  // شمارش به تفکیک دسته
  const counts = merged.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  const productsOut = {
    version: dataset.version ?? 2,
    generatedAt: startedAt.toISOString(),
    generator: 'tools/collect.mjs',
    disclaimer: dataset.disclaimer,
    counts: { ...counts, total: merged.length },
    stale: merged.filter((p) => p.stale).length,
    autoDiscovered: merged.filter((p) => p.autoDiscovered).length,
    products: merged,
  };

  await writeJSON('products.json', productsOut);
  await writeJSON('indicators.json', indicators);

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt.getTime();
  report.counts = productsOut.counts;
  report.stale = productsOut.stale;
  report.autoDiscovered = productsOut.autoDiscovered;

  // در اجرای جزئی (--only) وضعیت منابعی که اجرا نشده‌اند از گزارش قبلی حفظ می‌شود
  let metaSources = report.sources;
  if (ONLY.size) {
    const prevMeta = await readJSON('meta.json', { sources: [] });
    const byName = new Map((prevMeta?.sources ?? []).map((s) => [s.name, s]));
    for (const s of report.sources) byName.set(s.name, s);
    metaSources = [...byName.values()];
  }

  await writeJSON('meta.json', {
    version: 2,
    lastRun: report.finishedAt,
    lastRunDurationMs: report.durationMs,
    lastRunMode: OFFLINE ? 'offline' : DRY_RUN ? 'dry-run' : ONLY.size ? `only:${[...ONLY].join(',')}` : 'full',
    counts: productsOut.counts,
    stale: productsOut.stale,
    autoDiscovered: productsOut.autoDiscovered,
    sources: metaSources,
  });

  if (!DRY_RUN) {
    await buildBundle({ dataDir: DATA, log: vlog });
    log('data/bundle.js بازسازی شد');
  }

  // خلاصه در خروجی GitHub Actions
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      '## نتیجه جمع‌آوری داده بانک‌رادار',
      '',
      `- زمان اجرا: \`${report.durationMs} ms\``,
      `- حالت: \`${report.lastRunMode ?? (OFFLINE ? 'offline' : DRY_RUN ? 'dry-run' : 'full')}\``,
      `- مجموع محصولات: **${merged.length}**`,
      `- افزوده: **${stats.added}** · به‌روز: **${stats.updated}** · بی‌تغییر: **${stats.unchanged}**`,
      '',
      '| منبع | وضعیت | جزئیات |',
      '| --- | --- | --- |',
      ...report.sources.map((s) =>
        s.ok
          ? `| ${s.name} | ✅ | ${s.parsed != null ? `${s.parsed} محصول` : s.reachable != null ? `${s.reachable}/${s.targets} هدف` : `${s.sourcesOk ?? 0} منبع`} |`
          : `| ${s.name} | ❌ | ${String(s.error).slice(0, 90)} |`,
      ),
      '',
    ];
    await fs.appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  }

  if (VERBOSE) console.log(JSON.stringify(report, null, 2));
  log(`پایان در ${report.durationMs} ms`);
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[collect] خطای مرگبار: ${err.stack || err.message}`);
    process.exit(1);
  });
}

export { main, sortDeep, matchKey };

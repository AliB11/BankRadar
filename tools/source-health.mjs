#!/usr/bin/env node
/**
 * گزارش سلامت و تازگی منابع — تصویر یک‌نگاه از «چه چیزی تازه است و چه چیزی نه».
 *
 * ورودی‌ها: data/meta.json (آخرین اجرای خط لوله)، data/products.json،
 * data/indicators.json، data/crosscheck.json، data/link-health.json.
 * خروجی: data/source-health.json + جدول خوانا در ترمینال.
 *
 * چرا این ابزار جدا از collect است: اجرای collect به شبکه نیاز دارد و در
 * محیط بسته شکست می‌خورد؛ این گزارش از داده‌های موجود ساخته می‌شود و همیشه
 * قابل تولید است (در CI و محلی).
 *
 * استفاده:
 *   npm run health
 *   node tools/source-health.mjs --json     # فقط خروجی JSON
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshnessBuckets } from './collect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const JSON_ONLY = process.argv.includes('--json');

async function readJSON(name, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, name), 'utf8'));
  } catch {
    return fallback;
  }
}

/** رده‌بندی تازگی یک تاریخ ISO */
export function freshnessClass(iso, now = new Date()) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'unknown';
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(0, Math.floor((today - target) / 86_400_000));
  if (days <= 7) return 'fresh';
  if (days <= 30) return 'recent';
  if (days <= 90) return 'aging';
  return 'stale';
}

/** سلامت یک منبع بر پایهٔ ورودی meta */
export function sourceStatus(entry) {
  if (!entry) return 'unknown';
  // «سالم ولی از مسیر جایگزین» با «سالم مستقیم» یکی نیست: snapshot آرشیو یا
  // پروکسی متن یعنی داده ممکن است کهنه یا بازنویسی‌شده باشد.
  if (entry.ok === true && (entry.degraded === true || entry.via === 'wayback' || entry.via === 'proxy')) return 'degraded';
  if (entry.ok === true) return 'ok';
  return 'down';
}

/**
 * ساخت گزارش سلامت.
 * @param {{meta?:object, products?:object, indicators?:object, crosscheck?:object, linkHealth?:object, now?:Date}} input
 */
export function buildHealthReport(input = {}) {
  const now = input.now ?? new Date();
  const products = input.products?.products ?? [];
  const meta = input.meta ?? {};

  const sources = (meta.sources ?? []).map((entry) => ({
    name: entry.name,
    status: sourceStatus(entry),
    ok: entry.ok === true,
    ...(entry.degraded ? { degraded: true } : {}),
    ...(entry.via ? { via: entry.via } : {}),
    ...(entry.observedAt ? { observedAt: entry.observedAt } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.parsed != null ? { parsed: entry.parsed } : {}),
    ...(entry.reachable != null ? { reached: entry.reachable, targets: entry.targets } : {}),
    ...(entry.viaFallback != null ? { viaFallback: entry.viaFallback } : {}),
    ...(entry.empty != null ? { empty: entry.empty } : {}),
    ...(entry.sourcesOk != null ? { sourcesOk: entry.sourcesOk } : {}),
    ...(entry.matched != null ? { matched: entry.matched, mismatched: entry.mismatched } : {}),
  }));

  const degradedSources = sources.filter((s) => s.status !== 'ok').map((s) => s.name);

  const crosscheck = input.crosscheck
    ? {
        generatedAt: input.crosscheck.generatedAt ?? null,
        summary: input.crosscheck.summary ?? null,
        mismatches: (input.crosscheck.checks ?? [])
          .filter((c) => c.status !== 'match')
          .map((c) => ({ key: c.key, label: c.label, ours: c.ours, status: c.status, seen: (c.observations ?? []).map((o) => `${o.source}: ${o.value}`) })),
      }
    : null;

  const indicatorAges = Object.entries(input.indicators?.indicators ?? {}).map(([key, item]) => ({
    key,
    label: item.label ?? key,
    value: item.value,
    period: item.period ?? null,
    sourceKind: item.source?.kind ?? null,
    class: freshnessClass(item.officialDate ?? input.indicators?.generatedAt, now),
  }));

  const linkHealth = input.linkHealth
    ? { total: input.linkHealth.total ?? 0, ok: input.linkHealth.ok ?? 0, dead: input.linkHealth.dead ?? 0, healthPercent: input.linkHealth.healthPercent ?? null }
    : null;

  const freshness = input.products ? freshnessBuckets(products, now) : null;

  const categoryFreshness = {};
  for (const product of products) {
    const cat = product.category ?? 'unknown';
    categoryFreshness[cat] ??= { total: 0, fresh: 0, recent: 0, aging: 0, stale: 0, unknown: 0 };
    const cls = freshnessClass(product.lastUpdated ?? product.source?.checked, now);
    categoryFreshness[cat].total += 1;
    categoryFreshness[cat][cls] += 1;
  }

  return {
    generatedAt: now.toISOString(),
    lastRun: meta.lastRun ?? null,
    lastRunMode: meta.lastRunMode ?? null,
    counts: meta.counts ?? null,
    freshness,
    categoryFreshness,
    indicators: indicatorAges,
    sources,
    degradedSources,
    crosscheck,
    linkHealth,
    verdict: {
      dataFresh: freshness ? freshness.d7 + freshness.d30 >= Math.max(1, Math.round(freshness.total * 0.5)) : false,
      sourcesHealthy: sources.length ? degradedSources.length === 0 : false,
      note: 'اعداد این گزارش از دادهٔ ثبت‌شده ساخته می‌شوند، نه از واکشی زنده.',
    },
  };
}

async function main() {
  const [meta, products, indicators, crosscheck, linkHealth] = await Promise.all([
    readJSON('meta.json'),
    readJSON('products.json'),
    readJSON('indicators.json'),
    readJSON('crosscheck.json'),
    readJSON('link-health.json'),
  ]);

  const report = buildHealthReport({ meta, products, indicators, crosscheck, linkHealth });

  await fs.writeFile(
    path.join(DATA, 'source-health.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const pct = (n) => (report.freshness?.total ? `${Math.round((n / report.freshness.total) * 100)}%` : '—');
  console.log('سلامت منابع بانک‌رادار');
  console.log('─────────────────────────');
  console.log(`آخرین اجرای خط لوله: ${report.lastRun ?? '—'} (${report.lastRunMode ?? '—'})`);
  if (report.freshness) {
    const f = report.freshness;
    console.log(
      `تازگی داده: ۷ روز ${pct(f.d7)} · ۳۰ روز ${pct(f.d30)} · ۹۰ روز ${pct(f.d90)} · کهنه‌تر ${pct(f.older)} · نامعلوم ${pct(f.unknown)} (میانه ${f.medianDays ?? '—'} روز)`,
    );
  }
  console.log('');
  console.log('منبع                 وضعیت      جزئیات');
  for (const s of report.sources) {
    const detail =
      s.error ? String(s.error).slice(0, 70)
      : s.via ? `${s.via}${s.observedAt ? ` · ${s.observedAt.slice(0, 10)}` : ''}${s.parsed != null ? ` · ${s.parsed} رکورد` : ''}`
      : s.reached != null ? `${s.reached}/${s.targets} هدف`
      : s.sourcesOk != null ? `${s.sourcesOk} منبع`
      : s.matched != null ? `${s.matched} توافق / ${s.mismatched} اختلاف`
      : '—';
    console.log(`${s.name.padEnd(20)} ${s.status.padEnd(10)} ${detail}`);
  }
  if (report.crosscheck?.mismatches?.length) {
    console.log('');
    console.log('اختلاف منابع جایگزین با دادهٔ ثبت‌شده:');
    for (const m of report.crosscheck.mismatches) {
      console.log(`- ${m.key} (ما: ${m.ours ?? '—'}) — ${m.seen.join(' | ') || 'مقداری دیده نشد'}`);
    }
  }
  console.log('');
  console.log(`خروجی: data/source-health.json`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(`[health] خطا: ${err.stack || err.message}`);
    process.exit(1);
  });
}

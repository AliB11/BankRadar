#!/usr/bin/env node
/**
 * بررسی سلامت لینک‌های منبع — شفافیت لینک مرده.
 *
 * نمونه‌برداری از source.url محصولات و تلاش برای HEAD/GET سبک.
 * خروجی: data/link-health.json
 *
 * استفاده:
 *  node tools/check-links.mjs --limit=50 --concurrency=5
 *  node tools/check-links.mjs --offline  (اسکیپ شبکه)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const ARGS = process.argv.slice(2);
const OPT = (name, fallback = null) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const HAS = (name) => ARGS.includes(`--${name}`);

async function readJSON(name, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function checkUrl(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // ابتدا HEAD، در صورت شکست GET سبک
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    if (!res.ok && res.status === 405) {
      res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow', headers: { Range: 'bytes=0-1024' } });
    }
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, url };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.message, url };
  }
}

async function main() {
  if (HAS('offline')) {
    console.log('[link-check] حالت آفلاین — بررسی لینک‌ها نادیده گرفته شد');
    return;
  }
  const limit = Math.min(200, Math.max(10, Number(OPT('limit', 80)) || 80));
  const concurrency = Math.min(10, Math.max(1, Number(OPT('concurrency', 5)) || 5));

  const dataset = await readJSON('products.json');
  if (!dataset?.products) throw new Error('products.json یافت نشد');

  // نمونه‌برداری: اولویت با محصولات تازه‌تر و با اطمینان بالا
  const candidates = dataset.products
    .filter((p) => p.source?.url)
    .sort((a, b) => {
      const ca = a.confidence === 'high' ? 0 : 1;
      const cb = b.confidence === 'high' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return String(b.lastSeen || b.lastUpdated || '').localeCompare(String(a.lastSeen || a.lastUpdated || ''));
    })
    .slice(0, limit);

  const uniqueUrls = [...new Map(candidates.map((p) => [p.source.url, p])).values()];
  console.log(`[link-check] بررسی ${uniqueUrls.length} لینک منحصربه‌فرد با همزمانی ${concurrency}…`);

  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < uniqueUrls.length) {
      const current = idx++;
      const p = uniqueUrls[current];
      const res = await checkUrl(p.source.url);
      results.push({
        productId: p.id,
        bank: p.bank,
        product: p.product,
        url: p.source.url,
        ...res,
        checkedAt: new Date().toISOString(),
      });
      process.stdout.write(`\r[link-check] ${results.length}/${uniqueUrls.length} — ${res.ok ? '✓' : '✗'} ${res.status} ${p.source.url.slice(0, 60)}`);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log('\n');

  const okCount = results.filter((r) => r.ok).length;
  const dead = results.filter((r) => !r.ok);

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    ok: okCount,
    dead: dead.length,
    healthPercent: Math.round((okCount / Math.max(1, results.length)) * 100),
    deadLinks: dead.slice(0, 30),
    all: results,
  };

  await fs.writeFile(path.join(DATA, 'link-health.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[link-check] سلامت لینک: ${okCount}/${results.length} (${report.healthPercent}٪) — ${dead.length} مرده`);
  console.log(`[link-check] ذخیره شد: data/link-health.json`);
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[link-check] خطا: ${err.stack || err.message}`);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * ساخت data/bundle.js از فایل‌های JSON.
 *
 * چرا bundle؟ سامانه باید هم روی میزبان وب (GitHub Pages) و هم با باز کردن
 * مستقیم فایل index.html کار کند. در حالت file:// فراخوانی fetch به دلیل
 * محدودیت CORS مرورگر شکست می‌خورد؛ بنابراین داده در یک فایل JS قابل بارگذاری
 * با تگ <script> تزریق می‌شود. JSON خام هم برای مصرف‌کنندگان API باقی می‌ماند.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJSON(dir, file, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * @param {{dataDir?:string, outFile?:string, log?:Function}} [opts]
 */
export async function buildBundle(opts = {}) {
  const dataDir = opts.dataDir ?? path.join(ROOT, 'data');
  const outFile = opts.outFile ?? path.join(dataDir, 'bundle.js');
  const log = opts.log ?? (() => {});

  const [products, banks, indicators, meta] = await Promise.all([
    readJSON(dataDir, 'products.json', { products: [] }),
    readJSON(dataDir, 'banks.json', { banks: [] }),
    readJSON(dataDir, 'indicators.json', {}),
    readJSON(dataDir, 'meta.json', {}),
  ]);

  const payload = {
    products: products.products ?? [],
    banks: banks.banks ?? [],
    indicators: indicators.indicators ?? {},
    ranges: indicators.ranges ?? {},
    derived: indicators.derived ?? {},
    period: indicators.period ?? '',
    meta: {
      generatedAt: products.generatedAt ?? null,
      indicatorsGeneratedAt: indicators.generatedAt ?? null,
      banksGeneratedAt: banks.generatedAt ?? null,
      counts: products.counts ?? {},
      stale: products.stale ?? 0,
      autoDiscovered: products.autoDiscovered ?? 0,
      lastRun: meta.lastRun ?? null,
      lastRunMode: meta.lastRunMode ?? null,
      sources: meta.sources ?? [],
    },
  };

  const body = [
    '/* این فایل به‌طور خودکار توسط tools/build-bundle.mjs ساخته می‌شود — دستی ویرایش نکنید. */',
    `window.__BANK_RADAR__ = ${JSON.stringify(payload)};`,
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, body, 'utf8');
  log(`bundle ساخته شد: ${payload.products.length} محصول، ${payload.banks.length} بانک`);
  return { outFile, count: payload.products.length };
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  buildBundle({ log: console.log }).catch((err) => {
    console.error(`[bundle] خطا: ${err.message}`);
    process.exit(1);
  });
}

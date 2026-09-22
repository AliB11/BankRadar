#!/usr/bin/env node
/**
 * ساخت پوشه انتشار `public/` برای استقرار روی Vercel.
 *
 * چرا این اسکریپت لازم است: ورسل پس از اجرای دستور build انتظار دارد یک
 * «Output Directory» (به‌طور پیش‌فرض `public`) وجود داشته باشد؛ ولی ریشه
 * مخزن، سایت استاتیک است و دستور build فقط داده را جمع‌آوری و اعتبارسنجی
 * می‌کرد — پس استقرار با خطای «No Output Directory named public found»
 * شکست می‌خورد. این اسکریپت همان بسته‌ای را می‌سازد که گردش‌کار GitHub Pages
 * (در .github/workflows/deploy-pages.yml) در پوشه dist می‌سازد، اما در public.
 *
 * استفاده:
 *   node tools/build-public.mjs            # ساخت public از ریشه مخزن
 *   node tools/build-public.mjs --out=dist # پوشه خروجی سفارشی
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OPT = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const OUT = path.resolve(ROOT, OPT('out', 'public'));

// فایل‌ها و پوشه‌های زمان‌اجرا که مرورگر لازم دارد.
// ابزارها (tools/)، آزمون‌ها (tests/) و اسکریپت‌ها (scripts/) عمداً منتشر نمی‌شوند.
const ENTRIES = ['index.html', 'assets', 'data'];

async function main() {
  // پاک‌سازی خروجی قبلی تا فایل‌های حذف‌شده کهنه نمانند
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const entry of ENTRIES) {
    const src = path.join(ROOT, entry);
    const dest = path.join(OUT, entry);
    await fs.cp(src, dest, { recursive: true });
  }

  // هم‌ترازی با بسته GitHub Pages
  await fs.writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');

  // نگهبان: اگر فایل ورودی اصلی جا افتاده باشد، بی‌صدا یک سایت خراب منتشر نشود
  const indexFile = path.join(OUT, 'index.html');
  try {
    await fs.access(indexFile);
  } catch {
    throw new Error(`ساخت بسته انتشار ناموفق بود: ${indexFile} ساخته نشد`);
  }

  console.log(`[build:public] بسته انتشار ساخته شد: ${path.relative(ROOT, OUT)}/`);
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[build:public] خطا: ${err.message}`);
    process.exit(1);
  });
}

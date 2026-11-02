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
const PROTECTED = new Set(['assets', 'data', 'tools', 'scripts', 'tests', 'docs', 'index.html']);
const SAFE_OUTPUTS = new Set(['public', 'dist', 'build', 'out']);

/** هرگز ریشه، منابع، مسیر پنهان یا محل خارج از مخزن را پاک نکن. */
export async function validateOutputPath(out = OUT) {
  const rel = path.relative(ROOT, path.resolve(out));
  const first = rel.split(path.sep)[0];
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !first || first.startsWith('.') || PROTECTED.has(first)) {
    throw new Error('مسیر خروجی نباید ریشه، مسیر پنهان، منبع پروژه یا بیرون مخزن باشد');
  }
  // مسیرهای سفارشی موجود فقط اگر قبلاً توسط همین ابزار ساخته شده باشند پاک
  // می‌شوند؛ نام‌های متداول خروجی صریحاً برای سازگاری پشتیبانی می‌شوند.
  try {
    const stat = await fs.stat(out);
    if (!stat.isDirectory()) throw new Error('خروجی موجود پوشه نیست');
    if (!SAFE_OUTPUTS.has(first)) await fs.access(path.join(out, '.bankradar-build'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // اگر خود پوشه هست اما نشانگر نیست، آن را متعلق به کاربر بدان.
    try { await fs.stat(out); throw new Error('پوشه خروجی موجود نشانگر ساخت ندارد و پاک نمی‌شود'); }
    catch (inner) { if (inner.code !== 'ENOENT') throw inner; }
  }
  // والد واقعی نباید از طریق symlink بیرون از ریشه باشد.
  let parent = path.dirname(path.resolve(out));
  while (true) {
    try { parent = await fs.realpath(parent); break; }
    catch (err) { if (err.code !== 'ENOENT') throw err; parent = path.dirname(parent); }
  }
  const realRel = path.relative(await fs.realpath(ROOT), parent);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('والد خروجی خارج از مخزن است');
}

async function main() {
  // پیش از هر پاک‌سازی، مسیر و مالکیت خروجی بررسی می‌شود.
  await validateOutputPath();
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const entry of ENTRIES) {
    const src = path.join(ROOT, entry);
    const dest = path.join(OUT, entry);
    await fs.cp(src, dest, { recursive: true });
  }

  // هم‌ترازی با بسته GitHub Pages
  await fs.writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');
  await fs.writeFile(path.join(OUT, '.bankradar-build'), '', 'utf8');

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

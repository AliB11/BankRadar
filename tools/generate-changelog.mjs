#!/usr/bin/env node
/**
 * تولید CHANGELOG هفتگی و فید باز از تفاوت دو نسخه محصولات.
 *
 * استفاده:
 *  node tools/generate-changelog.mjs --old=data/products.json --new=data/products.json
 *  node tools/generate-changelog.mjs --history
 *
 * اگر old مشخص نشود، از آخرین نسخه تاریخچه در data/history/ استفاده می‌شود.
 * اگر هیچ تاریخچه‌ای نباشد، diff خالی تولید می‌شود.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffProducts, changelogToMarkdown, changelogToRSS } from './lib/changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const ARGS = process.argv.slice(2);
const OPT = (name, fallback = null) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const oldPath = OPT('old');
  const newPath = OPT('new', path.join(DATA, 'products.json'));
  const outDir = OPT('outDir', DATA);

  const newData = await readJSON(newPath);
  if (!newData?.products) throw new Error(`فایل جدید نامعتبر: ${newPath}`);

  let oldProducts = [];
  if (oldPath) {
    const oldData = await readJSON(oldPath);
    oldProducts = oldData?.products ?? [];
  } else {
    // تلاش برای یافتن آخرین تاریخچه
    try {
      const hist = await readJSON(path.join(DATA, 'history', 'weekly-history.json'));
      if (Array.isArray(hist) && hist.length) {
        const last = hist[hist.length - 1];
        oldProducts = last?.products ?? [];
      }
    } catch {
      // نادیده
    }
  }

  const diff = diffProducts(oldProducts, newData.products);
  const today = new Date().toISOString().slice(0, 10);

  const md = changelogToMarkdown(diff, { date: today });
  const rss = changelogToRSS(diff, { date: new Date().toISOString() });

  await fs.writeFile(path.join(outDir, 'changelog.json'), `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outDir, 'changelog.md'), `${md}\n`, 'utf8');
  await fs.writeFile(path.join(outDir, 'feed.xml'), `${rss}\n`, 'utf8');

  // تاریخچه سلامت
  await fs.mkdir(path.join(DATA, 'history'), { recursive: true });
  const historyPath = path.join(DATA, 'history', 'weekly-history.json');
  let history = [];
  try {
    history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }

  // افزودن رکورد فعلی به تاریخچه (فقط خلاصه، نه کل محصولات برای حجم)
  const weeklyReport = await readJSON(path.join(DATA, 'weekly-report.json'));
  if (weeklyReport) {
    history.push({
      date: today,
      generatedAt: weeklyReport.generatedAt,
      stats: weeklyReport.stats,
      macro: weeklyReport.macro,
      counts: weeklyReport.counts,
      anomalies: { total: weeklyReport.anomalies?.total ?? 0 },
    });
    // نگهداری 52 هفته اخیر
    if (history.length > 52) history = history.slice(-52);
    await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  }

  console.log(`[changelog] تغییرات: ${diff.summary.totalChanges} مورد`);
  console.log(`[changelog] افزوده: ${diff.summary.added}, نرخ: ${diff.summary.rateChanged}, stale: ${diff.summary.staleNow}`);
  console.log(`[changelog] فایل‌ها: changelog.json, changelog.md, feed.xml, history/weekly-history.json`);
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[changelog] خطا: ${err.stack || err.message}`);
    process.exit(1);
  });
}

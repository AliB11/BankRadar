#!/usr/bin/env node
/**
 * اعتبارسنجی مجموعه داده.
 *
 * دروازه کیفیت خط لوله: اگر داده نامعتبر باشد، CI شکست می‌خورد و به‌روزرسانی
 * منتشر نمی‌شود. بررسی‌ها شامل طرح‌واره، یکتایی شناسه، تطبیق دسته‌بندی با
 * بازه‌های معقول، اعتبار منبع و تازگی رکوردها است.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daysSince, today } from '../tools/lib/parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const CATEGORIES = new Set(['deposits', 'credit', 'loans', 'loyalty', 'funds']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const warnings = [];

const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

async function readJSON(file) {
  return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8'));
}

function checkProduct(p, index) {
  const at = `products[${index}] (${p?.id ?? 'بدون شناسه'})`;

  if (!p || typeof p !== 'object') return err(`${at}: رکورد شیء نیست`);
  for (const field of ['id', 'bank', 'product', 'category', 'lastUpdated']) {
    if (p[field] == null || p[field] === '') err(`${at}: فیلد الزامی «${field}» خالی است`);
  }
  if (p.id && !ID_RE.test(p.id)) err(`${at}: شناسه با الگوی مجاز مطابق نیست`);
  if (p.category && !CATEGORIES.has(p.category)) err(`${at}: دسته‌بندی نامعتبر «${p.category}»`);
  if (p.confidence && !CONFIDENCE.has(p.confidence)) err(`${at}: سطح اطمینان نامعتبر «${p.confidence}»`);
  if (p.lastUpdated && !ISO_RE.test(p.lastUpdated)) err(`${at}: تاریخ به‌روزرسانی ISO نیست`);
  if (p.lastUpdated && p.lastUpdated > today(48)) err(`${at}: تاریخ به‌روزرسانی در آینده است`);

  if (typeof p.rate !== 'number' || Number.isNaN(p.rate)) err(`${at}: نرخ عدد معتبر نیست`);
  else if (p.rate < 0 || p.rate > 100) err(`${at}: نرخ خارج از بازه ۰ تا ۱۰۰`);

  for (const [field, min, max] of [
    ['benefit', 0, 100],
    ['speed', 0, 100],
    ['digital', 0, 100],
    ['friction', 0, 100],
  ]) {
    const v = p[field];
    if (v == null) {
      // امتیازدهی توسط سامانه قابل محاسبه است
      continue;
    }
    if (typeof v !== 'number' || v < min || v > max) err(`${at}: «${field}» باید عددی بین ${min} و ${max} باشد`);
  }

  if (!p.source || !p.source.url) err(`${at}: منبع ثبت نشده است`);
  else if (!/^https?:\/\//.test(p.source.url)) err(`${at}: نشانی منبع معتبر نیست`);
  else if (!p.source.title) warn(`${at}: عنوان منبع خالی است`);

  if (p.minAmount != null && p.maxAmount != null && p.minAmount > p.maxAmount) {
    warn(`${at}: حداقل مبلغ از سقف بیشتر است`);
  }

  // دو تاریخ مستقل باید مستقل سنجیده شوند:
  //   lastSeen/lastVerified/source.checked — آخرین باری که خط لوله یا ممیزی رکورد را بازبینی کرد
  //   lastUpdated — آخرین باری که خود منبع (صفحه بانک) به‌روز شد
  // اگر این دو یکی گرفته شوند، رکوردی که به‌تازگی واکشی شده ولی صفحه‌اش ماه‌ها
  // دست‌نخورده مانده، «کنترل‌نشده» گزارش می‌شود و هشدار بی‌معنا می‌شود.
  const candidateDates = [p.lastSeen, p.lastVerified, p.source?.checked, p.lastUpdated].filter(
    (d) => typeof d === 'string' && ISO_RE.test(d),
  );
  const lastChecked = candidateDates.sort().pop() || p.lastSeen || p.lastVerified || p.source?.checked || p.lastUpdated;
  if (lastChecked) {
    const checkedAge = daysSince(lastChecked);
    if (checkedAge > 14) {
      warn(`${at}: ${checkedAge} روز از آخرین بازبینی خط لوله گذشته است`);
    }
  }

  if (p.lastUpdated) {
    const sourceAge = daysSince(p.lastUpdated);
    // کهنگی خود منبع ایراد این سامانه نیست؛ ولی باید دیده شود چون یعنی
    // ممکن است بانک نرخ را تغییر داده و صفحه به‌روز نشده باشد.
    if (sourceAge > 365) {
      warn(`${at}: صفحه منبع ${sourceAge} روز است به‌روز نشده (خودِ منبع کهنه است)`);
    }
  }

  if (
    p.lastSeen && p.lastUpdated &&
    Number.isFinite(Date.parse(p.lastUpdated)) &&
    Number.isFinite(Date.parse(p.lastSeen)) &&
    Date.parse(p.lastUpdated) > Date.parse(p.lastSeen)
  ) {
    err(`${at}: تاریخ به‌روزرسانی منبع از تاریخ بازبینی جلوتر است`);
  }

  if (p.autoDiscovered === true && p.confidence !== 'low' && p.confidence !== 'medium') {
    warn(`${at}: رکورد خودکار باید سطح اطمینان low یا medium داشته باشد`);
  }
}

function checkIndicators(ind) {
  if (!ind?.indicators) return err('indicators.json: بخش indicators یافت نشد');
  for (const [key, item] of Object.entries(ind.indicators)) {
    if (typeof item.value !== 'number' || Number.isNaN(item.value)) {
      err(`indicators.${key}: مقدار عددی نیست`);
    }
    if (item.value < -100 || item.value > 500) {
      err(`indicators.${key}: مقدار خارج از بازه معقول (${item.value})`);
    }
    if (!item.source?.url) warn(`indicators.${key}: منبع ثبت نشده است`);
  }
  for (const required of ['inflationAnnual', 'depositCap1y', 'loanRateCeiling']) {
    if (!ind.indicators[required]) err(`indicators: شاخص کلیدی «${required}» موجود نیست`);
  }
}

async function main() {
  console.log('اعتبارسنجی داده‌ها…');

  let dataset;
  try {
    dataset = await readJSON('products.json');
  } catch (e) {
    console.error(`✗ خواندن data/products.json ناموفق بود: ${e.message}`);
    process.exit(1);
  }

  const products = dataset.products ?? [];
  if (!Array.isArray(products) || products.length === 0) err('products: آرایه خالی است');

  const seen = new Set();
  products.forEach((p, i) => {
    checkProduct(p, i);
    if (p?.id) {
      if (seen.has(p.id)) err(`شناسه تکراری: «${p.id}»`);
      seen.add(p.id);
    }
  });

  // پوشش دسته‌بندی‌ها
  const byCat = products.reduce((a, p) => {
    a[p.category] = (a[p.category] || 0) + 1;
    return a;
  }, {});
  for (const c of CATEGORIES) {
    if (!byCat[c]) err(`هیچ محصولی در دسته «${c}» نیست`);
  }

  // آمار تطبیق counts
  if (dataset.counts && dataset.counts.total !== products.length) {
    err(`counts.total (${dataset.counts.total}) با تعداد واقعی (${products.length}) نمی‌خواند`);
  }

  try {
    checkIndicators(await readJSON('indicators.json'));
  } catch (e) {
    err(`خواندن indicators.json ناموفق بود: ${e.message}`);
  }

  try {
    const banks = await readJSON('banks.json');
    if (!Array.isArray(banks.banks) || banks.banks.length === 0) err('banks.json: فهرست بانک‌ها خالی است');
    const bankIds = new Set(banks.banks.map((b) => b.id));
    if (bankIds.size !== banks.banks.length) err('banks.json: شناسه بانک تکراری وجود دارد');
  } catch (e) {
    err(`خواندن banks.json ناموفق بود: ${e.message}`);
  }

  console.log(`  محصولات: ${products.length} (${Object.entries(byCat).map(([k, v]) => `${k}: ${v}`).join(' · ')})`);

  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} هشدار:`);
    warnings.slice(0, 40).forEach((w) => console.log(`  - ${w}`));
    if (warnings.length > 40) console.log(`  … و ${warnings.length - 40} هشدار دیگر`);
  }

  if (errors.length) {
    console.error(`\n✗ ${errors.length} خطا:`);
    errors.slice(0, 60).forEach((e) => console.error(`  - ${e}`));
    if (errors.length > 60) console.error(`  … و ${errors.length - 60} خطای دیگر`);

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      await fs.appendFile(
        summaryPath,
        `## ❌ اعتبارسنجی داده شکست خورد\n\n${errors.slice(0, 30).map((e) => `- ${e}`).join('\n')}\n`,
        'utf8',
      );
    }
    process.exit(1);
  }

  console.log('\n✓ اعتبارسنجی داده با موفقیت انجام شد');
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await fs.appendFile(
      summaryPath,
      `## ✅ اعتبارسنجی داده\n\n- محصولات: **${products.length}**\n- دسته‌ها: ${Object.entries(byCat).map(([k, v]) => `\`${k}\`: ${v}`).join(' · ')}\n- هشدارها: ${warnings.length}\n`,
      'utf8',
    );
  }
}

main().catch((e) => {
  console.error(`خطای غیرمنتظره: ${e.stack}`);
  process.exit(1);
});

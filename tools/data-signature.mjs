#!/usr/bin/env node
/**
 * امضای پایدار مجموعه داده «بانک‌رادار».
 *
 * چرا این ابزار لازم است:
 *   `data/products.json` در هر اجرا مهر `generatedAt` تازه می‌گیرد و
 *   `data/meta.json` زمان اجرا، مدت هر منبع و فهرست خطاها را ثبت می‌کند.
 *   اگر «تغییر داده» را با `git diff` روی کل `data/` بسنجیم، هر اجرای خط لوله
 *   — حتی وقتی هیچ منبعی پاسخ نداده و هیچ مقداری عوض نشده — یک کامیت
 *   بی‌محتوا می‌سازد؛ تاریخچه مخزن پر از نویز می‌شود و انتشار روزانه سایت
 *   بدون دلیل انجام می‌گیرد.
 *
 *   امضا فقط «بخش محتوایی» داده را در بر می‌گیرد:
 *     • محصولات (خودِ رکوردها، بدون مهر زمانیِ ساخت فایل)
 *     • شاخص‌های کلان، بازه‌های مصوب و مقدارهای مشتق
 *     • فهرست بانک‌ها
 *
 *   نکته: `lastSeen`، `lastVerified` و `stale` عمداً بخشی از امضا هستند، چون
 *   تغییرشان یعنی خط لوله واقعاً رکوردی را بازبینی کرده است — این یک
 *   به‌روزرسانی معنادار است، نه نویز.
 *
 * استفاده:
 *   node tools/data-signature.mjs                 # فقط امضا (۱۶ نویسه hex)
 *   node tools/data-signature.mjs --json          # امضا + شمارش‌ها
 *   node tools/data-signature.mjs --field=products # فقط یک مقدار (برای شل/CI)
 *   node tools/data-signature.mjs --dir data      # پوشه داده دلخواه
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** مرتب‌سازی بازگشتی کلیدها تا ترتیب کلیدها روی امضا اثر نگذارد */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalize(value[k])]),
    );
  }
  return value;
}

/**
 * امضای محتوایی یک مجموعه داده.
 * @param {{products?:object[], indicators?:object, banks?:object[]}} dataset
 * @returns {string} ۱۶ نویسه hex
 */
export function signatureOf(dataset = {}) {
  const products = Array.isArray(dataset.products) ? dataset.products : [];
  const indicators = dataset.indicators && typeof dataset.indicators === 'object' ? dataset.indicators : {};
  const banks = Array.isArray(dataset.banks) ? dataset.banks : [];

  const payload = canonicalize({
    products,
    indicators: indicators.indicators ?? {},
    ranges: indicators.ranges ?? {},
    derived: indicators.derived ?? {},
    period: indicators.period ?? '',
    banks,
  });

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return fallback;
    throw err;
  }
}

/**
 * خواندن مجموعه داده از پوشه داده و محاسبه امضا.
 * @param {string} [dataDir]
 */
export async function dataSignature(dataDir = path.join(ROOT, 'data')) {
  const [productsFile, indicators, banksFile] = await Promise.all([
    readJSON(path.join(dataDir, 'products.json'), { products: [] }),
    readJSON(path.join(dataDir, 'indicators.json'), {}),
    readJSON(path.join(dataDir, 'banks.json'), { banks: [] }),
  ]);

  const products = productsFile?.products ?? [];
  const banks = banksFile?.banks ?? [];

  if (!products.length) {
    throw new Error(`هیچ محصولی در ${path.join(dataDir, 'products.json')} یافت نشد`);
  }

  return {
    signature: signatureOf({ products, indicators, banks }),
    counts: {
      products: products.length,
      banks: banks.length,
      indicators: Object.keys(indicators?.indicators ?? {}).length,
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const asJSON = args.includes('--json');
  const option = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : null;
  };
  const dataDir = option('dir') ? path.resolve(option('dir')) : path.join(ROOT, 'data');
  const field = option('field');

  dataSignature(dataDir)
    .then((result) => {
      if (field) {
        // تک‌مقدار برای مصرف در شل و جریان‌های کاری (بدون تجزیه JSON در bash)
        const value = field === 'signature' ? result.signature : result.counts[field];
        if (value === undefined) {
          console.error(`[signature] فیلد ناشناخته: ${field}`);
          process.exit(1);
        }
        console.log(value);
        return;
      }
      if (asJSON) console.log(JSON.stringify(result, null, 2));
      else console.log(result.signature);
    })
    .catch((err) => {
      console.error(`[signature] خطا: ${err.message}`);
      process.exit(1);
    });
}

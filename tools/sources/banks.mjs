/**
 * منبع: وب‌سایت رسمی بانک‌ها و مؤسسات اعتباری.
 *
 * صفحه‌های «سپرده» و «تسهیلات» هر بانک با استخراج الگو-محور بررسی می‌شوند
 * (نه سلکتور CSS) تا نرخ‌های اعلامی و شرایط به‌دست آید. چون ساختار سایت هر بانک
 * متفاوت و گاه پشت محافظت است، خرابی یک بانک کل خط لوله را متوقف نمی‌کند و
 * شکست‌ها در گزارش سلامت ثبت می‌شوند.
 */

import { get, pool, runSource, unwrapPool } from '../lib/http.mjs';
import { normalizeText, stripTags, parseRates, parseAllAmounts } from '../lib/parse.mjs';

/**
 * فهرست اهداف پایش. هر هدف یک برچسب، نشانی و ترتیب اولویت دارد.
 * `expect`: نرخ‌هایی که در صورت یافت‌شدن معتبر تلقی می‌شوند (بازه مجاز).
 */
export const TARGETS = [
  { id: 'cbi-rates', label: 'بانک مرکزی — نرخ‌های سود', url: 'https://www.cbi.ir/simplelist/2088.aspx', kind: 'regulator', expect: [1, 35] },
  { id: 'cbi-circulars', label: 'بانک مرکزی — بخشنامه‌ها', url: 'https://www.cbi.ir/simplelist/1466.aspx', kind: 'regulator', expect: [1, 35] },
  { id: 'melli-deposit', label: 'بانک ملی ایران — سپرده‌ها', url: 'https://bmi.ir/fa/deposit', kind: 'bank', expect: [1, 35] },
  { id: 'mellat-deposit', label: 'بانک ملت — سپرده‌ها', url: 'https://bankmellat.ir/deposits', kind: 'bank', expect: [1, 35] },
  { id: 'tejarat-deposit', label: 'بانک تجارت — سپرده‌ها', url: 'https://tejaratbank.ir/دپارتمان-حساب-سپرده', kind: 'bank', expect: [1, 35] },
  { id: 'saderat-deposit', label: 'بانک صادرات — سپرده‌ها', url: 'https://www.bsi.ir/Services/Deposits', kind: 'bank', expect: [1, 35] },
  { id: 'sepah-deposit', label: 'بانک سپه — سپرده‌ها', url: 'https://banksepah.ir/سپرده', kind: 'bank', expect: [1, 35] },
  { id: 'eghtesad-novin', label: 'بانک اقتصاد نوین', url: 'https://www.enbank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'parsian', label: 'بانک پارسیان', url: 'https://parsian-bank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'pasargad', label: 'بانک پاسارگاد', url: 'https://www.bpi.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'saman', label: 'بانک سامان', url: 'https://www.sb24.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'refah', label: 'بانک رفاه کارگران', url: 'https://www.refah-bank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'maskan', label: 'بانک مسکن', url: 'https://www.bank-maskan.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'karafarin', label: 'بانک کارآفرین', url: 'https://www.karafarinbank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'shahr', label: 'بانک شهر', url: 'https://www.shahr-bank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'sina', label: 'بانک سینا', url: 'https://www.sinabank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'mehr-iran', label: 'بانک قرض‌الحسنه مهر ایران', url: 'https://www.qmb.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'resalat', label: 'بانک قرض‌الحسنه رسالت', url: 'https://www.rqbank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'blubank', label: 'بلوبانک', url: 'https://blubank.com/', kind: 'bank', expect: [1, 35] },
  { id: 'vipad', label: 'ویپاد', url: 'https://wepod.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'middle-east', label: 'بانک خاورمیانه', url: 'https://www.mebank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'keshavarzi', label: 'بانک کشاورزی', url: 'https://www.bki.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'gardeshgari', label: 'بانک گردشگری', url: 'https://www.gardeshgari-bank.com/', kind: 'bank', expect: [1, 35] },
  { id: 'bankino', label: 'بانکینو', url: 'https://bankino.digital/', kind: 'bank', expect: [1, 35] },
  { id: 'tobank', label: 'توبانک', url: 'https://tobank.ir/', kind: 'bank', expect: [1, 35] },
];

/**
 * استخراج نرخ‌های سود اعلامی از متن یک صفحه بانک.
 * جست‌وجو در نزدیکی کلیدواژه‌های «سود»، «نرخ»، «سپرده» برای کاهش نویز.
 * @param {string} html
 * @param {[number,number]} [expect]
 * @returns {{rates:number[], amounts:number[], keywords:string[]}}
 */
export function extractBankSignals(html, expect = [1, 35]) {
  const text = normalizeText(stripTags(html));
  const [lo, hi] = expect;

  const nearby = [];
  const re = /(.{0,80}?(?:نرخ\s*سود|سود\s*(?:سالانه|علی‌الحساب|سپرده)|کارمزد\s*(?:سالانه)?)[^.]{0,120})/g;
  let m;
  while ((m = re.exec(text)) !== null) nearby.push(m[1]);

  const rates = [...new Set(
    [...parseRates(nearby.join(' '))].filter((r) => r >= lo && r <= hi),
  )].sort((a, b) => b - a);

  const amounts = [...new Set(parseAllAmounts(nearby.join(' ')).filter((a) => a >= 1_000_000))];

  const keywords = [];
  for (const kw of ['سپرده بلندمدت', 'سپرده کوتاه‌مدت', 'حداقل موجودی', 'نرخ شکست', 'قرض‌الحسنه', 'علی‌الحساب']) {
    if (text.includes(kw)) keywords.push(kw);
  }

  return { rates, amounts, keywords };
}

/**
 * واکشی همه اهداف بانکی.
 * @param {{concurrency?:number, log?:Function, targets?:typeof TARGETS}} [opts]
 */
export async function collect(opts = {}) {
  const { concurrency = 4, log = () => {}, targets = TARGETS } = opts;

  const tasks = targets.map((target) => async () => {
    const result = await runSource(target.id, async () => {
      const html = await get(target.url, {
        timeout: 25_000,
        retries: 1,
        headers: { Referer: 'https://www.google.com/' },
      });
      const signals = extractBankSignals(html, target.expect);
      return { ...signals, bytes: html.length };
    });
    return { target, ...result };
  });

  // pool نتیجه هر کار را در پاکت {ok,data} می‌پیچد (تا استثنای یک کار بقیه را
  // نکشد). اگر پاکت باز نشود، r.target تعریف‌نشده است و همان اولین دسترسی به
  // r.target.id استثنا پرتاب می‌کند؛ آن استثنا از collect بیرون می‌رود و کل منبع
  // «بانک‌ها» با پیام بی‌معنای «Cannot read properties of undefined» از دست
  // می‌رود. unwrapPool پاکت را باز می‌کند و هدف را بر پایه اندیس بازمی‌گرداند.
  const results = unwrapPool(await pool(tasks, concurrency), targets, 'target');
  const observations = [];

  for (const r of results) {
    if (r.ok && r.data) {
      observations.push({
        id: r.target.id,
        label: r.target.label,
        url: r.target.url,
        kind: r.target.kind,
        ok: true,
        rates: r.data.rates,
        amounts: r.data.amounts.slice(0, 12),
        keywords: r.data.keywords,
        bytes: r.data.bytes,
      });
      log(`${r.target.label}: ${r.data.rates.length} نرخ شناسایی شد`);
    } else {
      observations.push({
        id: r.target.id,
        label: r.target.label,
        url: r.target.url,
        kind: r.target.kind,
        ok: false,
        error: r.error,
      });
      log(`${r.target.label}: ناموفق — ${r.error}`);
    }
  }

  return {
    source: 'bank-sites',
    targets: targets.length,
    ok: observations.filter((o) => o.ok).length,
    observations,
  };
}

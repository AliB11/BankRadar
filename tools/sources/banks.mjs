/**
 * منبع: وب‌سایت رسمی بانک‌ها و مؤسسات اعتباری.
 *
 * صفحه‌های «سپرده» و «تسهیلات» هر بانک با استخراج الگو-محور بررسی می‌شوند
 * (نه سلکتور CSS) تا نرخ‌های اعلامی و شرایط به‌دست آید. چون ساختار سایت هر بانک
 * متفاوت و گاه پشت محافظت است، خرابی یک بانک کل خط لوله را متوقف نمی‌کند و
 * شکست‌ها در گزارش سلامت ثبت می‌شوند.
 */

import { pool, runSource, unwrapPool } from '../lib/http.mjs';
import { fetchResilient, summarizeAttempts } from '../lib/resilience.mjs';
import { normalizeText, stripTags, parseRates, parseAllAmounts } from '../lib/parse.mjs';

/**
 * فهرست اهداف پایش. هر هدف یک برچسب، نشانی، آینه‌های جایگزین و ترتیب اولویت دارد.
 * `expect`: نرخ‌هایی که در صورت یافت‌شدن معتبر تلقی می‌شوند (بازه مجاز).
 * `mirrors`: نشانی‌های جایگزین همان نهاد (دامنهٔ دیگر یا مسیر تازه) — پیش از
 *   آرشیو امتحان می‌شوند.
 * `wayback`: اگر true، در صورت بسته‌بودن مسیر مستقیم از snapshot آرشیو استفاده
 *   می‌شود (با تاریخ خود snapshot، نه تاریخ امروز).
 *
 * درس ممیزی ۱۲ آبان ۱۴۰۵: نشانی‌های `www.cbi.ir/simplelist/*` حذف شده‌اند و با
 * کد ۲۰۰ متن «Page Not Found» برمی‌گرداندند؛ بنابراین «موفقِ بی‌نرخ» ثبت
 * می‌شدند. نشانی درست نرخ‌های سیاستی `PolicyRates/policyrates_fa.aspx` است.
 */
export const TARGETS = [
  { id: 'cbi-policy-rates', label: 'بانک مرکزی — نرخ سود سیاستی', url: 'https://www.cbi.ir/PolicyRates/policyrates_fa.aspx', kind: 'regulator', expect: [1, 35] },
  { id: 'melli-deposit', label: 'بانک ملی ایران — سپرده‌ها', url: 'https://bmi.ir/fa/deposit', kind: 'bank', expect: [1, 35], mirrors: ['https://bank-melli.ir/fa/deposit'] },
  { id: 'mellat-deposit', label: 'بانک ملت — سپرده‌ها', url: 'https://bankmellat.ir/deposits', kind: 'bank', expect: [1, 35], mirrors: ['https://www.bankmellat.ir/deposits'] },
  { id: 'tejarat-deposit', label: 'بانک تجارت — سپرده‌ها', url: 'https://tejaratbank.ir/دپارتمان-حساب-سپرده', kind: 'bank', expect: [1, 35], mirrors: ['https://www.tejaratbank.ir/'] },
  { id: 'saderat-deposit', label: 'بانک صادرات — سپرده‌ها', url: 'https://www.bsi.ir/Services/Deposits', kind: 'bank', expect: [1, 35] },
  { id: 'sepah-deposit', label: 'بانک سپه — سپرده‌ها', url: 'https://banksepah.ir/سپرده', kind: 'bank', expect: [1, 35], mirrors: ['https://www.banksepah.ir/'] },
  { id: 'eghtesad-novin', label: 'بانک اقتصاد نوین', url: 'https://www.enbank.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'parsian', label: 'بانک پارسیان', url: 'https://parsian-bank.ir/', kind: 'bank', expect: [1, 35], mirrors: ['https://www.parsian-bank.ir/'] },
  { id: 'pasargad', label: 'بانک پاسارگاد', url: 'https://www.bpi.ir/', kind: 'bank', expect: [1, 35] },
  { id: 'saman', label: 'بانک سامان', url: 'https://www.sb24.ir/', kind: 'bank', expect: [1, 35], mirrors: ['https://samanbank.ir/'] },
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
 * داوری دربارهٔ «سیگنال واقعی» یک هدف.
 *
 * سه حالت را از هم جدا می‌کند تا گزارش سلامت صادق بماند:
 *   ۱. سیگنال تازه (trustworthy)
 *   ۲. دسترسی بود ولی سیگنالی نبود (empty) — صفحهٔ خالی یا «Page Not Found»
 *   ۳. سیگنال از snapshot کهنهٔ آرشیو (staleSnapshot) — شاهد امروز نیست
 *
 * @param {{rates?:number[], keywords?:string[], ageDays?:number|null}} input
 */
export function assessTargetSignal({ rates = [], keywords = [], ageDays = null } = {}) {
  const hasSignal = rates.length > 0;
  const staleSnapshot = ageDays != null && ageDays > 90;
  return {
    hasSignal,
    staleSnapshot,
    trustworthy: hasSignal && !staleSnapshot,
    weak: !hasSignal && keywords.length > 0,
  };
}

/**
 * واکشی همه اهداف بانکی.
 * @param {{concurrency?:number, log?:Function, targets?:typeof TARGETS}} [opts]
 */
export async function collect(opts = {}) {
  const { concurrency = 4, log = () => {}, targets = TARGETS, now = () => new Date() } = opts;

  const tasks = targets.map((target) => async () => {
    const result = await runSource(target.id, async () => {
      // زنجیرهٔ جایگزین: اصلی → آینه‌ها → آرشیو → پروکسی متن
      const page = await fetchResilient(target.url, {
        mirrors: target.mirrors ?? [],
        allowWayback: target.wayback !== false,
        allowProxy: target.allowProxy === true,
        timeout: 25_000,
        retries: 1,
        headers: { Referer: 'https://www.google.com/' },
        now,
      });
      const signals = extractBankSignals(page.text, target.expect);
      return {
        ...signals,
        bytes: page.text.length,
        via: page.via,
        resolvedUrl: page.resolvedUrl,
        observedAt: page.observedAt,
        ageDays: page.ageDays,
        degraded: page.degraded,
        chain: summarizeAttempts(page.attempts),
      };
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
      // «دسترسی موفق» با «سیگنال واقعی» یکی نیست. پیش‌تر هدفی که صفحهٔ
      // «Page Not Found» یا صفحهٔ خالی برمی‌گرداند هم ok:true می‌گرفت و
      // سلامت منابع را سبز نشان می‌داد (یافتهٔ F1 در ممیزی ۱۲ آبان ۱۴۰۵).
      const rates = r.data.rates ?? [];
      const keywords = r.data.keywords ?? [];
      // snapshot کهنه «شاهد امروز» نیست: نرخ یک سال پیش، نرخ امروز را اثبات
      // نمی‌کند. آستانه ۹۰ روز انتخاب شده تا تعطیلات و سرویس‌های کم‌بازدید را
      // پوشش دهد، ولی داده فصلی/سالانه را «تازه» جا نزند.
      const { hasSignal, staleSnapshot, trustworthy, weak } = assessTargetSignal({
        rates,
        keywords,
        ageDays: r.data.ageDays ?? null,
      });
      observations.push({
        id: r.target.id,
        label: r.target.label,
        url: r.target.url,
        kind: r.target.kind,
        ok: trustworthy,
        reached: true,
        ...(hasSignal ? {} : { empty: true, weak }),
        ...(staleSnapshot ? { staleSnapshot: true, note: `snapshot ${r.data.ageDays} روز کهنه` } : {}),
        rates,
        amounts: (r.data.amounts ?? []).slice(0, 12),
        keywords,
        bytes: r.data.bytes,
        via: r.data.via,
        resolvedUrl: r.data.resolvedUrl,
        observedAt: r.data.observedAt,
        ageDays: r.data.ageDays,
        degraded: r.data.degraded === true,
        chain: r.data.chain,
      });
      log(
        staleSnapshot
          ? `${r.target.label}: سیگنال از snapshot کهنه (${r.data.ageDays} روز) — شاهد امروز نیست`
          : hasSignal
            ? `${r.target.label}: ${rates.length} نرخ شناسایی شد (${r.data.via}${r.data.ageDays ? `، ${r.data.ageDays} روز کهنه` : ''})`
            : `${r.target.label}: دسترسی برقرار بود ولی سیگنالی نبود (${r.data.via})`,
      );
    } else {
      observations.push({
        id: r.target.id,
        label: r.target.label,
        url: r.target.url,
        kind: r.target.kind,
        ok: false,
        reached: false,
        error: r.error,
      });
      log(`${r.target.label}: ناموفق — ${r.error}`);
    }
  }

  return {
    source: 'bank-sites',
    targets: targets.length,
    ok: observations.filter((o) => o.ok).length,
    reached: observations.filter((o) => o.reached).length,
    viaFallback: observations.filter((o) => o.ok && o.via && o.via !== 'direct').length,
    empty: observations.filter((o) => o.empty).length,
    observations,
  };
}

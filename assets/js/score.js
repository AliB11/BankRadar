/**
 * موتور امتیازدهی «جذابیت از دید مشتری».
 *
 * تفاوت کلیدی با نسخه قبلی: امتیاز صرفاً جمع وزنی خام نیست. سه اصلاح مهم
 * اعمال می‌شود تا امتیاز با واقعیت اقتصادی ایران هم‌خوان باشد:
 *
 *  ۱. نرخ واقعی: برای محصولات منابعی، نرخ اسمی در برابر تورم سنجیده می‌شود.
 *  ۲. هزینه فرصت: برای تسهیلات سپرده‌محور، پولی که خواب می‌ماند جریمه می‌خورد.
 *  ۳. اعتبار منبع: رکوردهای خودکار و کم‌اطمینان امتیاز کمتری می‌گیرند.
 */

import { daysSince, faNum, faPercent, faSignedPercent } from './util.js';
import { effectiveAnnualRate, canEstimateLoan } from './finance.js';

export const WEIGHT_KEYS = ['benefit', 'digital', 'speed', 'friction', 'fresh'];

export const WEIGHT_META = {
  benefit: { label: 'مزیت مالی', min: 0, max: 50, def: 28, hint: 'نرخ/بازده و هزینه مالی نسبت به گزینه‌های جایگزین' },
  digital: { label: 'سهولت دیجیتال', min: 0, max: 40, def: 20, hint: 'امکان انجام کامل فرآیند بدون مراجعه حضوری' },
  speed: { label: 'سرعت دسترسی', min: 0, max: 30, def: 16, hint: 'زمان از درخواست تا دریافت' },
  friction: { label: 'کمبود وثیقه', min: 0, max: 30, def: 18, hint: 'نبود ضامن، وثیقه و سپرده مسدودی' },
  fresh: { label: 'تازگی داده', min: 0, max: 20, def: 10, hint: 'کنترل‌شدن اطلاعات در دوره اخیر' },
};

export const DEFAULT_WEIGHTS = Object.fromEntries(
  Object.entries(WEIGHT_META).map(([k, v]) => [k, v.def]),
);

export const PRESETS = {
  balanced: { label: 'متعادل', w: { ...DEFAULT_WEIGHTS } },
  cheap: { label: 'کم‌هزینه‌ترین', w: { benefit: 46, digital: 12, speed: 10, friction: 22, fresh: 10 } },
  digital: { label: 'دیجیتال‌محور', w: { benefit: 18, digital: 38, speed: 22, friction: 14, fresh: 8 } },
  fast: { label: 'سریع‌ترین', w: { benefit: 14, digital: 18, speed: 40, friction: 14, fresh: 14 } },
  noCollateral: { label: 'بدون وثیقه', w: { benefit: 16, digital: 16, speed: 14, friction: 44, fresh: 10 } },
};

/** امتیاز تازگی داده (۰ تا ۱۰۰) با افت تدریجی */
/**
 * تازگی کنترل‌شدن یک رکورد.
 *
 * دو تاریخ متفاوت وجود دارد و خلط کردن آن‌ها نتیجه را گمراه می‌کند:
 *   lastUpdated — تاریخ آخرین به‌روزرسانی خودِ منبع (مثلاً صفحه بانک)
 *   lastSeen    — تاریخی که خط لوله این رکورد را دیده و بازبینی کرده است
 *
 * رکوردی که امروز واکشی شده، «کنترل‌شده» است حتی اگر صفحه منبع ماه‌ها
 * دست‌نخورده مانده باشد. اگر فقط lastUpdated را ملاک بگیریم، صدها رکورد
 * تازه‌واکشی‌شده کهنه به نظر می‌رسند. کهنگی خود منبع در جای دیگری گزارش
 * می‌شود (ستون «به‌روزرسانی منبع» و آمار جداگانه).
 *
 * @param {string|{lastUpdated?:string, lastSeen?:string}} input
 */
export function freshnessScore(input) {
  const iso = typeof input === 'object' && input !== null
    ? mostRecent(input.lastUpdated, input.lastSeen)
    : input;
  const d = daysSince(iso);
  if (!Number.isFinite(d)) return 20;
  if (d <= 7) return 100;
  // هر پله از دقیقاً همان مقدار پایانی پلهٔ قبل شروع می‌شود تا یک روز تفاوت
  // در تاریخ، جهش پله‌ای در امتیاز نسازد:
  //   ۷ روز → ۱۰۰ ، ۳۰ روز → ۷۲ ، ۹۰ روز → ۴۲ ، ۱۸۰ روز → ۲۴
  if (d <= 30) return 100 - (d - 7) * (28 / 23);
  if (d <= 90) return 72 - (d - 30) * 0.5;
  if (d <= 180) return 42 - (d - 90) * 0.2;
  // پس از ۱۸۰ روز، تا سقف ۴۲۰ روز به ۵ نمره می‌رسد و در آنجا کف می‌کند.
  return Math.max(5, 24 - (d - 180) * (19 / 240));
}

/** جدیدترین تاریخ از میان چند مقدار (به شکل ISO) */
export function mostRecent(...dates) {
  let best = null;
  for (const d of dates) {
    if (!d) continue;
    const s = String(d);
    if (best === null || s >= best) best = s;
  }
  return best;
}

/**
 * ضریب اعتبار منبع: هرچه اطمینان کمتر و خودکار بودن بیشتر، ضریب پایین‌تر.
 * اثر آن محدود است (±۸٪) تا امتیاز را مخدوش نکند.
 */
function reliabilityFactor(product) {
  let f = 1;
  if (product.confidence === 'low') f -= 0.05;
  else if (product.confidence === 'medium') f -= 0.02;
  if (product.autoDiscovered) f -= 0.03;
  if (product.stale) f -= 0.06;
  return f;
}

/**
 * محاسبه امتیاز جذابیت.
 * @param {object} product
 * @param {object} weights مقادیر وزن‌ها
 * @param {{inflation?:number, interbankRate?:number}} [ctx] زمینه کلان
 * @returns {{score:number, parts:Record<string,number>, realRate:number|null, adjustment:number}}
 */
export function scoreProduct(product, weights, ctx = {}) {
  // کل رکورد داده می‌شود تا هم تاریخ منبع و هم تاریخ کنترل دیده شود
  const fresh = freshnessScore(product);

  const parts = {
    benefit: clamp01(product.benefit ?? 55),
    digital: clamp01(product.digital ?? 55),
    speed: clamp01(product.speed ?? 55),
    friction: clamp01(product.friction ?? 55),
    fresh,
  };

  const totalWeight = WEIGHT_KEYS.reduce((a, k) => a + (Number(weights[k]) || 0), 0) || 1;
  let base = WEIGHT_KEYS.reduce((a, k) => a + parts[k] * (Number(weights[k]) || 0), 0) / totalWeight;

  // اصلاح ۱: نرخ واقعی برای محصولات منابعی
  const inflation = ctx.inflation ?? null;
  let realRate = null;
  let adjustment = 0;

  const basis = basisAnnualRate(product);
  if (inflation != null && basis != null && Number.isFinite(basis)) {
    // مبنای تسهیلات نرخ مؤثر سالانه با جریان واقعی اقساط تخمینی است.
    const real = (1 + basis / 100) / (1 + inflation / 100) - 1;
    realRate = Number((real * 100).toFixed(1));

    if (product.category === 'deposits' || product.category === 'funds') {
      // بازده حقیقی منفی شدید → جریمه متناسب (حداکثر ۱۲ نمره)
      if (realRate < 0) adjustment -= Math.min(12, Math.abs(realRate) * 0.18);
    } else if (product.category === 'loans' && product.rate <= 6) {
      // تسهیلات قرض‌الحسنه در تورم بالا برای مشتری بسیار ارزشمند است
      adjustment += Math.min(10, Math.max(0, (inflation - basis) * 0.14));
    } else if ((product.category === 'loans' || product.category === 'credit') && product.rate >= 20) {
      // نرخ تسهیلات بالای ۲۰٪ در برابر تورم هنوز ارزش حقیقی مثبت دارد اما کمتر
      adjustment += Math.min(6, Math.max(0, (inflation - basis) * 0.06));
    }
  }

  // اصلاح ۲: هزینه فرصت سپرده مسدود
  if (product.collateralKind === 'deposit-block') {
    adjustment -= 5;
  }

  // اصلاح ۳: اعتبار منبع
  const reliable = base * reliabilityFactor(product);
  const finalScore = Math.max(0, Math.min(100, Math.round(reliable + adjustment)));

  return { score: finalScore, parts, realRate, adjustment: Number(adjustment.toFixed(1)) };
}

const clamp01 = (v) => Math.min(100, Math.max(0, Number(v) || 0));

/** رنگ امتیاز برای نمایش */
export function scoreTone(score) {
  if (score >= 80) return { key: 'good', color: '#2fe0a8', label: 'بسیار جذاب' };
  if (score >= 68) return { key: 'good', color: '#5ce8b8', label: 'جذاب' };
  if (score >= 55) return { key: 'warn', color: '#f6c66b', label: 'متوسط' };
  if (score >= 42) return { key: 'warn', color: '#ffa76b', label: 'ضعیف' };
  return { key: 'bad', color: '#ff6b81', label: 'کم‌جذاب' };
}

/** توضیح امتیاز به زبان طبیعی — برای شفافیت الگوریتم */
export function explainScore(product, result, ctx = {}) {
  const lines = [];
  const { parts } = result;

  const strongest = WEIGHT_KEYS.slice(0, 4)
    .map((k) => ({ k, v: parts[k] }))
    .sort((a, b) => b.v - a.v)[0];
  const weakest = WEIGHT_KEYS.slice(0, 4)
    .map((k) => ({ k, v: parts[k] }))
    .sort((a, b) => a.v - b.v)[0];

  // همه اعداد با ارقام فارسی درج می‌شوند تا متن با بقیه رابط یکدست بماند
  if (strongest) lines.push(`قوی‌ترین بعد: ${WEIGHT_META[strongest.k].label} با ${faNum(Math.round(strongest.v))} از ۱۰۰`);
  if (weakest) lines.push(`ضعیف‌ترین بعد: ${WEIGHT_META[weakest.k].label} با ${faNum(Math.round(weakest.v))} از ۱۰۰`);

  if (result.realRate != null) {
    // برچسب باید با دسته هم‌خوان باشد: عدد منفی برای سپرده و صندوق «خبر بد» و برای
    // تسهیلات «خبر خوب» است، پس واژه یکسان برای هر دو گمراه‌کننده است.
    const isDepositOrFund = product.category === 'deposits' || product.category === 'funds';
    const label = isDepositOrFund ? 'بازده حقیقی' : 'هزینه حقیقی';
    const verdict = isDepositOrFund
      ? result.realRate < 0
        ? 'منفی است؛ نگهداری پول در این محصول قدرت خرید را کاهش می‌دهد'
        : 'مثبت است؛ این محصول تورم را جبران می‌کند'
      : result.realRate < 0
        ? 'منفی است؛ هزینه واقعی استقراض کمتر از تورم است و به سود وام‌گیرنده تمام می‌شود'
        : 'مثبت است؛ هزینه واقعی استقراض از تورم پیشی می‌گیرد';
    lines.push(
      `${label} ${faSignedPercent(result.realRate)} با احتساب تورم ${faPercent(ctx.inflation)} — ${verdict}`,
    );
  }

  if (result.adjustment !== 0) {
    const n = faNum(Math.abs(result.adjustment));
    lines.push(
      result.adjustment > 0
        ? `اصلاح مثبت ${n} نمره، به‌دلیل ارزش حقیقی بالای این محصول در شرایط تورمی`
        : `اصلاح منفی ${n} نمره، به‌دلیل فرسایش ارزش پول و/یا الزام مسدودی سپرده`,
    );
  }

  if (product.availability === 'historical') lines.push('این محصول تاریخی است و عرضه جدید آن تأیید نشده است');
  if (product.stale) lines.push('این رکورد در آخرین واکشی دیده نشد و ممکن است منقضی شده باشد');
  if (product.confidence === 'low') lines.push('سطح اطمینان داده پایین است؛ پیش از اقدام تأیید شود');

  return lines;
}

/** نرخ مبنای فیشر؛ برای وام‌ها جریان اقساط و برای سپرده نرخ اعلامی. */
export function basisAnnualRate(product) {
  if (!product || product.rateKnown === false || product.rateKind === 'none' || product.availability === 'historical') return null;
  const rate = Number(product.rate);
  if (!Number.isFinite(rate) || rate < 0) return null;
  if (product.category === 'loans' || product.category === 'credit' || product.rateKind === 'fee') {
    if (!canEstimateLoan(product)) return null;
    const principal = product.maxAmount ?? product.minAmount;
    const months = product.termMonths;
    if (!(principal > 0) || !(months > 0)) return null;
    return effectiveAnnualRate(product, principal, months);
  }
  return rate;
}

/**
 * موتور محاسبات مالی.
 *
 * سه شیوه هزینه‌گذاری در نظام بانکی ایران رایج است و نادیده گرفتن تفاوت
 * آن‌ها نتیجه را به‌شدت گمراه‌کننده می‌کند:
 *
 *   ۱) سود سالانه (rateKind: 'profit') — روش غالب در تسهیلات و سپرده‌ها.
 *      قسط استاندارد (PMT): قسط = P·r / (1 − (1+r)^−n)
 *      قسط قدیمی:           سود = P·R·(n+1) / 2400 ، قسط = (P + سود) / n
 *
 *   ۲) کارمزد یک‌بار (rateKind: 'fee') — روش قرض‌الحسنه و وام‌های حمایتی.
 *      در این محصولات عدد ۴٪ نرخ سالانه نیست؛ کارمزد یک‌باری است که یک بار
 *      روی کل اصل بسته می‌شود. اگر آن را نرخ سالانه فرض کنیم، هزینه وام
 *      ده‌ساله حدود ده برابر واقعیت برآورد می‌شود. این تفکیک در تابع
 *      scheduleFee پیاده شده است.
 *
 *   ۳) بازده سپرده (rateKind: 'yield') — سود سالانه سپرده.
 *
 * افزون بر آن، «نرخ مؤثر واقعی» با روش IRR محاسبه می‌شود و نرخ حقیقی بر پایه
 * رابطه فیشر به دست می‌آید: در تورم بالای ایران مهم‌ترین عدد برای تصمیم مشتری.
 */

/** نرخ ماهانه از نرخ سالانه درصدی */
const monthlyRate = (annualPercent) => annualPercent / 100 / 12;

/**
 * قسط ماهانه به روش استاندارد (PMT).
 * @param {number} principal مبلغ وام (تومان)
 * @param {number} annualRate نرخ سالانه (درصد)
 * @param {number} months تعداد اقساط
 * @returns {number} قسط ماهانه
 */
export function installmentStandard(principal, annualRate, months) {
  if (!principal || !months) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return principal / months;
  const factor = (1 + r) ** months;
  return (principal * r * factor) / (factor - 1);
}

/**
 * کل سود و مجموع بازپرداخت به روش استاندارد.
 * @returns {{installment:number, totalInterest:number, totalPayment:number}}
 */
export function scheduleStandard(principal, annualRate, months) {
  const inst = installmentStandard(principal, annualRate, months);
  const totalPayment = inst * months;
  return {
    installment: Math.round(inst),
    totalInterest: Math.round(totalPayment - principal),
    totalPayment: Math.round(totalPayment),
  };
}

/**
 * قسط ماهانه به روش قدیمی (سود مازاد + تقسیم مساوی).
 * @returns {{installment:number, totalInterest:number, totalPayment:number}}
 */
export function scheduleLegacy(principal, annualRate, months, gapMonths = 1) {
  if (!principal || !months) return { installment: 0, totalInterest: 0, totalPayment: 0 };
  const totalInterest = (principal * annualRate * (months + gapMonths)) / 2400;
  const totalPayment = principal + totalInterest;
  return {
    installment: Math.round(totalPayment / months),
    totalInterest: Math.round(totalInterest),
    totalPayment: Math.round(totalPayment),
  };
}

/**
 * قسط برای محصولات کارمزد‌محور (قرض‌الحسنه و وام‌های حمایتی).
 *
 * در این محصولات کارمزد یک بار روی کل اصل بسته می‌شود و مبلغ حاصل به اقساط
 * مساوی تقسیم می‌گردد. هیچ سود مرکبی وجود ندارد.
 *
 * مثال: ۳۰۰ میلیون تومان با کارمزد ۴٪ و ۱۲۰ قسط
 *        هزینه کل = ۱۲ میلیون ، قسط = ۲ میلیون و ۶۰۰ هزار تومان
 *
 * @param {number} principal مبلغ تسهیلات (تومان)
 * @param {number} feePercent کارمزد یک‌بار (درصد از اصل)
 * @param {number} months تعداد اقساط
 * @returns {{installment:number, totalInterest:number, totalPayment:number}}
 */
export function scheduleFee(principal, feePercent, months) {
  if (!principal || !months) return { installment: 0, totalInterest: 0, totalPayment: 0 };
  const fee = (principal * (feePercent || 0)) / 100;
  const totalPayment = principal + fee;
  return {
    installment: Math.round(totalPayment / months),
    totalInterest: Math.round(fee),
    totalPayment: Math.round(totalPayment),
  };
}

/**
 * انتخاب خودکار شیوه محاسبه بر پایه نوع نرخ محصول.
 *
 * این تابع نقطه ورود واحد برای همه مصرف‌کنندگان است تا اشتباه «نرخ سالانه
 * فرض کردن کارمزد یک‌بار» تکرار نشود.
 *
 * @param {{rate?:number, rateKind?:string}} product
 * @param {number} principal
 * @param {number} months
 * @param {'standard'|'legacy'} [method]
 */
export function scheduleFor(product, principal, months, method = 'standard') {
  const rate = product?.rate ?? 0;
  if (product?.rateKind === 'fee') return scheduleFee(principal, rate, months);
  if (method === 'legacy') return scheduleLegacy(principal, rate, months);
  return scheduleStandard(principal, rate, months);
}

/**
 * نرخ مؤثر سالانه با روش IRR.
 *
 * نرخ مؤثری می‌یابد که ارزش فعلی اقساط را با مبلغ خالص دریافتی برابر کند.
 * «خالص دریافتی» کلید ماجراست: اگر بانک کارمزدی از اصل کسر کند، وام‌گیرنده
 * کمتر از اصل دریافت می‌کند و نرخ واقعی بالاتر می‌رود.
 *
 * دامنه واقع‌گرایانه: کارمزد ۴ درصدی کسرشده از اصل، نرخ مؤثر یک تسهیلات ۲۳
 * درصدی چهارساله را به حدود ۲۵٫۴ درصد می‌رساند، نه ۳۳ تا ۳۵ درصد. ارقام
 * بالاتر که در گزارش‌های میدانی نقل می‌شود، هزینه‌های دیگر (بیمه، سپرده
 * مسدود، کارمزد ضامن، هزینه فرصت) را هم در بر می‌گیرد که در این تابع محاسبه
 * نمی‌شوند. بنابراین خروجی این تابع را «کف نرخ مؤثر» بدانید، نه سقف آن.
 *
 * @param {number} installment قسط ماهانه
 * @param {number} months تعداد اقساط
 * @param {number} netReceived مبلغ خالص دریافتی وام‌گیرنده
 * @returns {number} نرخ مؤثر سالانه به درصد (۰ تا ۱۰۰)
 */
export function irrAnnual(installment, months, netReceived) {
  if (!installment || !months || netReceived <= 0) return 0;

  // ارزش فعلی اقساط با نرخ ماهانه r
  const pv = (r) => (r === 0 ? installment * months : (installment * (1 - (1 + r) ** -months)) / r);

  let lo = 0;
  let hi = 1; // سقف جست‌وجو: ۱۰۰٪ ماهانه
  // اگر حتی با نرخ صفر هم اقساط کمتر از دریافتی باشد، نرخ منفی است
  if (pv(0) <= netReceived) return 0;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netReceived) lo = mid;
    else hi = mid;
  }
  return Number((((lo + hi) / 2) * 12 * 100).toFixed(2));
}

/**
 * نرخ مؤثر سالانه یک محصول با در نظر گرفتن شیوه هزینه‌گذاری آن.
 *
 * @param {object} product
 * @param {number} principal
 * @param {number} months
 * @param {number} upfrontFee کارمزد کسرشده از اصل (درصد)
 * @param {'standard'|'legacy'} [method] شیوه قسط‌بندی — باید با همان شیوه‌ای باشد
 *   که قسط نمایش‌داده‌شده با آن محاسبه شده تا نرخ مؤثر با قسط هم‌خوان بماند
 */
export function effectiveAnnualRate(product, principal, months, upfrontFee = 0, method = 'standard') {
  const { installment } = scheduleFor(product, principal, months, method);
  const netReceived = principal * (1 - (upfrontFee || 0) / 100);
  return irrAnnual(installment, months, netReceived);
}

/**
 * نرخ بازده واقعی: نرخ اسمی منهای تورم.
 * @param {number} nominalRate نرخ اسمی (درصد)
 * @param {number} inflationRate تورم سالانه (درصد)
 * @returns {number} نرخ واقعی (درصد) — معمولاً منفی
 */
export function realRate(nominalRate, inflationRate) {
  if (nominalRate == null || inflationRate == null) return null;
  // رابطه فیشر دقیق: (۱+i)/(۱+π) − ۱ ؛ برای تورم بالا تفاوت آن با تفاضل ساده مادی است
  const real = (1 + nominalRate / 100) / (1 + inflationRate / 100) - 1;
  return Number((real * 100).toFixed(1));
}

/**
 * قدرت خرید معادل مبلغ اسمی پس از n سال با تورم مفروض.
 * @param {number} amount مبلغ اسمی (تومان)
 * @param {number} inflationRate تورم سالانه (درصد)
 * @param {number} years تعداد سال
 * @returns {number} ارزش حقیقی
 */
export function presentValue(amount, inflationRate, years) {
  if (amount == null || inflationRate == null) return null;
  return Math.round(amount / (1 + inflationRate / 100) ** years);
}

/**
 * هزینه فرصت «خواب سپرده»: پولی که برای امتیازسازی تسهیلات مسدود می‌شود.
 * @param {number} depositAmount مبلغ سپرده
 * @param {number} years مدت مسدودی (سال)
 * @param {number} inflationRate تورم سالانه
 * @param {number} alternativeRate نرخ بازده جایگزین (مثلاً نرخ بین‌بانکی)
 * @returns {{nominalLoss:number, realLoss:number}}
 */
export function opportunityCost(depositAmount, years, inflationRate, alternativeRate) {
  const nominalLoss = Math.round(
    depositAmount * ((1 + alternativeRate / 100) ** years - 1),
  );
  const realLoss = Math.round(
    depositAmount - presentValue(depositAmount, inflationRate, years),
  );
  return { nominalLoss, realLoss };
}

/**
 * خلاصه مالی یک محصول برای نمایش در کارت، جدول مقایسه و کشو.
 *
 * @param {object} product
 * @param {{inflation?:number, method?:'standard'|'legacy'}} [opts]
 */
export function loanSummary(product, opts = {}) {
  const principal = product.maxAmount ?? product.minAmount ?? 0;
  const months = product.termMonths ?? 36;
  const method = opts.method ?? 'standard';
  const inflation = opts.inflation ?? null;
  const isFee = product.rateKind === 'fee';

  const standard = scheduleFor(product, principal, months, method);
  const legacy = isFee
    ? scheduleFee(principal, product.rate, months)
    : scheduleLegacy(principal, product.rate, months);

  // کارمزد اضافی فقط برای تسهیلات سودمحور معنا دارد؛ در محصولات کارمزد‌محور
  // عدد rate خودش کارمزد است و افزودن دوباره آن، هزینه را دو برابر نشان می‌دهد.
  const upfrontFee = !isFee && product.rate >= 20 ? 4 : 0;
  const effective = effectiveAnnualRate(product, principal, months, upfrontFee, method);

  return {
    principal,
    months,
    rate: product.rate ?? 0,
    rateKind: product.rateKind ?? 'profit',
    isFee,
    standard,
    legacy,
    effective,
    real: inflation != null ? realRate(effective, inflation) : null,
    difference: Math.abs(standard.totalInterest - legacy.totalInterest),
  };
}

/**
 * شبیه‌ساز مسیر ذوب تورمی اقساط وام.
 *
 * در تورم بالا، قدرت خرید قسط اسمی ثابت با گذشت هر سال فرسایش می‌یابد.
 * این تابع ارزش واقعی هر قسط و درصد افت بار پرداخت برای وام‌گیرنده را محاسبه می‌کند.
 *
 * @param {number} installment مبلغ اسمی قسط ماهانه (تومان)
 * @param {number} months کل دوره بازپرداخت (ماه)
 * @param {number} annualInflation نرخ تورم سالانه فرضی (درصد)
 * @returns {Array<{year:number, nominalInstallment:number, realPurchasingPower:number, erosionPercent:number}>}
 */
export function installmentInflationTrajectory(installment, months, annualInflation) {
  if (!installment || !months || !annualInflation || annualInflation <= 0) return [];
  const years = Math.ceil(months / 12);
  const trajectory = [];

  for (let y = 1; y <= years; y++) {
    const discount = (1 + annualInflation / 100) ** (y - 0.5);
    const realPower = Math.round(installment / discount);
    const erosion = Math.round((1 - realPower / installment) * 100);
    trajectory.push({
      year: y,
      nominalInstallment: installment,
      realPurchasingPower: realPower,
      erosionPercent: Math.min(99, Math.max(0, erosion)),
    });
  }
  return trajectory;
}

/**
 * تحلیل فرصت: دریافت وام و تخصیص به گزینه‌های با درآمد ثابت (آربیتراژ ریالی).
 *
 * @param {number} principal مبلغ وام
 * @param {number} installment قسط ماهانه
 * @param {number} months مدت اقساط
 * @param {number} alternativeAnnualYield نرخ بازده سالانه گزینه جایگزین (درصد)
 * @returns {{totalReinvestmentReturn:number, totalLoanRepayment:number, netGainOrLoss:number, isProfitable:boolean}}
 */
export function loanArbitrageAnalysis(principal, installment, months, alternativeAnnualYield) {
  if (!principal || !installment || !months || !alternativeAnnualYield) {
    return { totalReinvestmentReturn: 0, totalLoanRepayment: 0, netGainOrLoss: 0, isProfitable: false };
  }
  const totalLoanRepayment = installment * months;
  const years = months / 12;
  const totalReinvestmentReturn = Math.round(principal * ((1 + alternativeAnnualYield / 100) ** years));
  const netGainOrLoss = totalReinvestmentReturn - totalLoanRepayment;
  return {
    totalReinvestmentReturn,
    totalLoanRepayment,
    netGainOrLoss,
    isProfitable: netGainOrLoss > 0,
  };
}

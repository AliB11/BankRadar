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
 *   ۲) کارمزد قرض‌الحسنه (rateKind: 'fee') — برای وام‌ها، یک مدل تقریبی
 *      با کارمزد سالانه روی مانده و قسط کارمزد در آغاز هر سال به کار می‌رود.
 *      قرارداد واقعی ممکن است متفاوت باشد؛ برای اعتبار غیر بانکی یا کارمزد
 *      یک‌باره باید نوع محاسبه صریحاً در feeModel مشخص شود.
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
 * برآورد رایج قرض‌الحسنه: کارمزد سالانه روی مانده، در اولین قسط هر سال.
 * اقساط دیگر اصل را به‌طور مساوی بازپرداخت می‌کنند. برای سال ناقص، کارمزد
 * متناسب با تعداد ماه‌های باقیمانده است. در دوره تک‌ماهه اصل و کارمزد با هم
 * پرداخت می‌شوند. این یک مدل تخمینی است و قرارداد بانک ملاک نهایی است.
 *
 * ۳۰۰ میلیون، ۴٪ و ۱۲۰ ماه: ۱۱۰ قسط اصل حدود ۲٫۷۲۷ میلیون و ده قسط
 * سالانه کارمزد (اولین قسط ۱۲ میلیون)، در مجموع ۶۶ میلیون کارمزد.
 */
export function scheduleFee(principal, feePercent, months) {
  const n = Math.max(0, Math.trunc(Number(months) || 0));
  const amount = Math.max(0, Number(principal) || 0);
  const rate = Math.max(0, Number(feePercent) || 0) / 100;
  if (!amount || !n) return { installment: 0, totalInterest: 0, totalPayment: 0, payments: [], feePayments: [], firstFee: 0, maxInstallment: 0 };

  // کارمزد صفر قسط مجزای کارمزد ندارد.
  if (!rate) {
    const payment = amount / n;
    return { installment: Math.round(payment), totalInterest: 0, totalPayment: Math.round(amount), payments: Array(n).fill(payment), feePayments: [], firstFee: 0, maxInstallment: Math.round(payment) };
  }

  const feeOnlyMonths = new Set();
  for (let start = 0; start < n; start += 12) {
    if (Math.min(12, n - start) > 1) feeOnlyMonths.add(start);
  }
  const principalPayment = amount / (n - feeOnlyMonths.size);
  let balance = amount;
  const payments = [];
  const feePayments = [];
  let totalFee = 0;

  for (let month = 0; month < n; month++) {
    let fee = 0;
    if (month % 12 === 0) {
      fee = balance * rate * Math.min(12, n - month) / 12;
      feePayments.push({ month: month + 1, amount: Math.round(fee) });
      totalFee += fee;
    }
    const principalPart = feeOnlyMonths.has(month) ? 0 : Math.min(balance, principalPayment);
    balance -= principalPart;
    payments.push(principalPart + fee);
  }

  return {
    installment: Math.round(principalPayment),
    totalInterest: Math.round(totalFee),
    totalPayment: Math.round(amount + totalFee),
    payments,
    feePayments,
    firstFee: feePayments[0]?.amount ?? 0,
    maxInstallment: Math.round(Math.max(...payments)),
  };
}

/** کارمزد یک‌باره فقط وقتی مشخصاً در قرارداد ثبت شده باشد. */
export function scheduleOneTimeFee(principal, feePercent, months) {
  const n = Math.max(0, Math.trunc(Number(months) || 0));
  const amount = Math.max(0, Number(principal) || 0);
  if (!amount || !n) return { installment: 0, totalInterest: 0, totalPayment: 0, payments: [] };
  const fee = amount * Math.max(0, Number(feePercent) || 0) / 100;
  const payment = (amount + fee) / n;
  return { installment: Math.round(payment), totalInterest: Math.round(fee), totalPayment: Math.round(amount + fee), payments: Array(n).fill(payment) };
}

/** مدل کارمزد ناشناخته (مثلاً BNPL) نباید مثل قرض‌الحسنه برآورد شود. */
export function canEstimateLoan(product) {
  if (!product || product.rateKnown === false || product.paymentSchedule === 'variable') return false;
  if (product.rateKind !== 'fee') return true;
  if (product.feeModel === 'unknown') return false;
  if (product.feeModel === 'annual-balance' || product.feeModel === 'one-time') return true;
  return product.category !== 'credit';
}

/** انتخاب مدل طبق نوع نرخ؛ فرض قرض‌الحسنه صرفاً یک برآورد است. */
export function scheduleFor(product, principal, months, method = 'standard') {
  if (!canEstimateLoan(product)) return null;
  const rate = product?.rate ?? 0;
  if (product?.rateKind === 'fee') {
    return product.feeModel === 'one-time'
      ? scheduleOneTimeFee(principal, rate, months)
      : scheduleFee(principal, rate, months);
  }
  return method === 'legacy' ? scheduleLegacy(principal, rate, months) : scheduleStandard(principal, rate, months);
}

/**
 * IRR جریان اقساط ماهانه، با تبدیل ماهانه به نرخ مؤثر سالانه مرکب.
 * ترتیب و مقدار واقعی اقساط مهم است، به‌خصوص قسط‌های سالانه کارمزد.
 */
export function irrCashflows(payments, netReceived) {
  if (!Array.isArray(payments) || !payments.length || !(netReceived > 0)) return 0;
  if (payments.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const pv = (r) => payments.reduce((sum, amount, i) => sum + amount / (1 + r) ** (i + 1), 0);
  if (pv(0) <= netReceived) return 0;
  let lo = 0;
  let hi = 1;
  while (pv(hi) > netReceived && hi < 1_000_000) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netReceived) lo = mid;
    else hi = mid;
  }
  return Number((((1 + (lo + hi) / 2) ** 12 - 1) * 100).toFixed(2));
}

/** نرخ مؤثر برای اقساط مساوی؛ ورودی قسط ماهانه به تومان است. */
export function irrAnnual(installment, months, netReceived) {
  const n = Math.max(0, Math.trunc(Number(months) || 0));
  if (!installment || !n || netReceived <= 0) return 0;
  return irrCashflows(Array(n).fill(installment), netReceived);
}

/** نرخ مؤثر طبق همان مدل قسط و هزینه کسرشده صریح از اصل وام. */
export function effectiveAnnualRate(product, principal, months, upfrontFee = 0, method = 'standard') {
  const schedule = scheduleFor(product, principal, months, method);
  if (!schedule) return null;
  const fee = Number(upfrontFee) || 0;
  if (fee < 0 || fee >= 100) return null;
  const netReceived = principal * (1 - fee / 100);
  const payments = schedule.payments ?? Array(Math.max(0, Math.trunc(months))).fill(schedule.installment);
  return irrCashflows(payments, netReceived);
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
  if (!standard) return null;
  const legacy = isFee ? standard : scheduleLegacy(principal, product.rate, months);

  // هیچ هزینه کسر از اصل بدون شاهد یا ورود کاربر فرض نمی‌شود.
  const effective = effectiveAnnualRate(product, principal, months, opts.upfrontFee ?? 0, method);

  return {
    principal,
    months,
    rate: product.rate ?? 0,
    rateKind: product.rateKind ?? 'profit',
    isFee,
    standard,
    legacy,
    effective,
    real: inflation != null && effective != null ? realRate(effective, inflation) : null,
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

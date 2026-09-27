/**
 * آزمون‌های سازوکار به‌روزرسانی هفتگی، ممیزی و درون‌ریزی خروجی داده‌ها.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV,
  matchBank,
  parseInputData,
  detectAnomalies,
  auditCuratedProducts,
  generateWeeklyReport,
} from '../tools/sync-weekly.mjs';
import {
  installmentInflationTrajectory,
  loanArbitrageAnalysis,
} from '../assets/js/finance.js';

/* ---------- ۱) آزمون‌های تجزیه‌گر CSV ---------- */

test('تجزیه‌گر CSV سطرها و ستون‌های استاندارد را استخراج می‌کند', () => {
  const csv = `"id","bank","product","category","rate"
"p-1","بانک ملت","سپرده ملت","deposits","22.5"
"p-2","بانک سامان","وام سامان","loans","23"`;

  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'p-1');
  assert.equal(rows[0].bank, 'بانک ملت');
  assert.equal(rows[0].rate, '22.5');
  assert.equal(rows[1].bank, 'بانک سامان');
});

test('تجزیه‌گر CSV کاما و علامت نقل‌قول دوبل داخل فیلدها را مدیریت می‌کند', () => {
  const csv = `"product","desc"
"طرح ویژه","تسهیلات با شرایط خاص، شامل تخفیف ""ویژه"" کارمزد"`;

  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product, 'طرح ویژه');
  assert.equal(rows[0].desc, 'تسهیلات با شرایط خاص، شامل تخفیف "ویژه" کارمزد');
});

/* ---------- ۲) تطبیق نام بانک‌ها ---------- */

test('matchBank نام رسمی و نام‌های مستعار را شناسایی می‌کند', () => {
  const bankList = [
    { id: 'tejarat', name: 'بانک تجارت', aliases: ['تجارت'] },
    { id: 'blubank', name: 'بلوبانک', aliases: ['بلو', 'سامان بلو'] },
    { id: 'melli', name: 'بانک ملی ایران', aliases: ['ملی', 'بانک ملی'] },
  ];

  assert.equal(matchBank('بانک تجارت', bankList).id, 'tejarat');
  assert.equal(matchBank('تجارت', bankList).id, 'tejarat');
  assert.equal(matchBank('بلو', bankList).id, 'blubank');
  assert.equal(matchBank('بانک ملی', bankList).id, 'melli');
  assert.equal(matchBank('بانک ناشناس فرضی', bankList).name, 'بانک ناشناس فرضی');
});

/* ---------- ۳) نرمال‌سازی خروجی ورودی ---------- */

test('parseInputData ورودی خروجی را به ساختار استاندارد محصولات تبدیل می‌کند', () => {
  const bankList = [{ id: 'tejarat', name: 'بانک تجارت', aliases: ['تجارت'] }];
  const input = JSON.stringify([
    {
      bank: 'تجارت',
      product: 'تسهیلات پویا',
      category: 'loans',
      rate: '23',
      rateKind: 'profit',
      maxAmount: '200000000',
      termMonths: '36',
      sourceUrl: 'https://tejaratbank.ir/loan',
    },
  ]);

  const result = parseInputData(input, 'feed.json', bankList);
  assert.equal(result.length, 1);
  const p = result[0];
  assert.equal(p.bank, 'بانک تجارت');
  assert.equal(p.bankId, 'tejarat');
  assert.equal(p.product, 'تسهیلات پویا');
  assert.equal(p.rate, 23);
  assert.equal(p.maxAmount, 200_000_000);
  assert.equal(p.termMonths, 36);
  assert.equal(p.source.url, 'https://tejaratbank.ir/loan');
  assert.ok(p.lastVerified);
  assert.ok(p.lastSeen);
});

/* ---------- ۴) پایش ناهنجاری‌ها و مصوبات ---------- */

test('detectAnomalies انحرافات نرخ سپرده و سقف‌های تسهیلات را شناسایی می‌کند', () => {
  const products = [
    {
      id: 'p-high-dep',
      bank: 'بانک آزمایشی ۱',
      product: 'سپرده با سود ۳۰٪',
      category: 'deposits',
      rate: 30,
      contractType: 'unknown',
    },
    {
      id: 'p-bad-range',
      bank: 'بانک آزمایشی ۲',
      product: 'وام با دامنه معکوس',
      category: 'loans',
      rate: 23,
      contractType: 'non-partnership',
      minAmount: 500_000_000,
      maxAmount: 100_000_000,
    },
    {
      id: 'p-trap',
      bank: 'بانک آزمایشی ۳',
      product: 'وام مسدودی',
      category: 'loans',
      rate: 23,
      contractType: 'non-partnership',
      collateralKind: 'deposit-block',
    },
  ];

  const indicators = {
    indicators: {
      depositCap1y: { value: 23 },
      loanRateCeiling: { value: 23 },
    },
  };

  const anomalies = detectAnomalies(products, indicators);
  assert.ok(anomalies.some((a) => a.id === 'cbi-deposit-cap-exceeded'));
  assert.ok(anomalies.some((a) => a.id === 'invalid-amount-range'));
  assert.ok(anomalies.some((a) => a.id === 'hidden-opportunity-cost-trap'));
});

/* ---------- ۵) ممیزی رکوردهای دست‌نویس ---------- */

test('auditCuratedProducts تاریخ کنترل رکوردهای دست‌نویس را به‌روزرسانی می‌کند', () => {
  const products = [
    {
      id: 'curated-1',
      autoDiscovered: false,
      product: 'سپرده دستی',
      source: { url: 'https://bank.ir', checked: '2026-08-01' },
      lastUpdated: '2026-08-01',
    },
    {
      id: 'auto-1',
      autoDiscovered: true,
      product: 'وام خودکار',
      source: { url: 'https://rade.ir', checked: '2026-08-01' },
      lastUpdated: '2026-08-01',
    },
  ];

  const { audited, verifiedCount } = auditCuratedProducts(products, { date: '2026-09-19' });
  assert.equal(verifiedCount, 1);
  assert.equal(audited[0].lastVerified, '2026-09-19');
  assert.equal(audited[0].source.checked, '2026-09-19');
  // رکورد خودکار دست‌نخورده می‌ماند
  assert.equal(audited[1].lastVerified, undefined);
});

/* ---------- ۶) گزارش ممیزی هفتگی ---------- */

test('generateWeeklyReport ساختار گزارش کامل با امتیاز سلامت تولید می‌کند', () => {
  // تاریخ امروز برای تازگی ۱۰۰٪ — آزمون نباید به تاریخ تقویم وابسته باشد
  const todayISO = new Date().toISOString().slice(0, 10);
  const report = generateWeeklyReport({
    products: [
      { id: '1', category: 'deposits', autoDiscovered: false, lastVerified: todayISO, lastSeen: todayISO },
      { id: '2', category: 'loans', autoDiscovered: true, lastSeen: todayISO, lastVerified: todayISO },
    ],
    indicators: {
      indicators: { inflationAnnual: { value: 65 }, depositCap1y: { value: 23 } },
      derived: { realDepositReturnAnnual: -42 },
    },
    anomalies: [],
  });

  assert.equal(report.version, 2);
  assert.equal(report.counts.total, 2);
  // هر دو محصول امروز بازبینی شده‌اند → تازگی ۱۰۰٪ و سلامت ۱۰۰
  assert.equal(report.stats.verifiedIn7Days, 2);
  assert.equal(report.stats.freshnessPercent, 100);
  assert.equal(report.stats.healthScore, 100);
  assert.equal(report.macro.inflationAnnual, 65);
  assert.ok(report.period);
});

/* ---------- ۷) آزمون‌های شبیه‌ساز مالی خلاقانه ---------- */

test('installmentInflationTrajectory ذوب ارزش واقعی اقساط را در گذر سال‌ها محاسبه می‌کند', () => {
  const installment = 10_000_000;
  const trajectory = installmentInflationTrajectory(installment, 60, 50);

  assert.equal(trajectory.length, 5);
  // ارزش واقعی قسط در سال اول کمتر از مبلغ اسمی است
  assert.ok(trajectory[0].realPurchasingPower < installment);
  // ارزش واقعی در سال‌های بعد نزولی است (فرسایش تورمی بار قسط)
  for (let i = 1; i < trajectory.length; i++) {
    assert.ok(trajectory[i].realPurchasingPower < trajectory[i - 1].realPurchasingPower);
    assert.ok(trajectory[i].erosionPercent > trajectory[i - 1].erosionPercent);
  }
  // در سال پنجم با تورم ۵۰٪، بار واقعی قسط بیش از ۸۰٪ فرسایش یافته است
  assert.ok(trajectory[4].erosionPercent >= 80);
});

test('loanArbitrageAnalysis سود و زیان تخصیص وام به گزینه‌های با درآمد ثابت را می‌سنجد', () => {
  const P = 100_000_000;
  const inst = 3_900_000;
  const months = 36;

  // اگر بازده سالانه جایگزین خیلی بالا باشد (مثلاً ۳۵٪)، آربیتراژ سودآور می‌شود
  const profitable = loanArbitrageAnalysis(P, inst, months, 35);
  assert.ok(profitable.totalReinvestmentReturn > profitable.totalLoanRepayment);
  assert.equal(profitable.isProfitable, true);

  // اگر بازده سالانه کم باشد (مثلاً ۱۰٪)، نگهداری در درآمد ثابت هزینه اقساط را جبران نمی‌کند
  const loss = loanArbitrageAnalysis(P, inst, months, 10);
  assert.equal(loss.isProfitable, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { scheduleFee, scheduleFor, effectiveAnnualRate, irrCashflows, loanSummary } from '../assets/js/finance.js';
import { basisAnnualRate, scoreProduct, DEFAULT_WEIGHTS } from '../assets/js/score.js';
import { normalizeProduct, store, filtered } from '../assets/js/store.js';
import { cardHTML, detailHTML, rankHTML } from '../assets/js/views.js';
import { mergeProducts } from '../tools/collect.mjs';
import { selectFetchSet, mapToProduct } from '../tools/sources/rade.mjs';
import { macroPeriodIndex, mergeMacroObservations } from '../tools/sources/cbi.mjs';
import { detectAnomalies } from '../tools/sync-weekly.mjs';
import { sameOriginPost, server } from '../tools/serve.mjs';
import { validateOutputPath } from '../tools/build-public.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/* جریان اقساط متغیر و نرخ مؤثر */
test('کارمزد سالانه نزولی مطابق نمونه ۳۵۰ میلیونی محاسبه می‌شود', () => {
  const result = scheduleFee(350_000_000, 4, 120);
  assert.equal(result.installment, 3_181_818);
  assert.equal(result.firstFee, 14_000_000);
  assert.equal(result.totalInterest, 77_000_000);
  assert.equal(result.totalPayment, 427_000_000);
  assert.equal(result.feePayments.length, 10);
  assert.equal(result.payments.length, 120);
  assert.equal(Math.round(result.payments.reduce((a, b) => a + b, 0)), 427_000_000);
  assert.ok(result.feePayments[1].amount < result.feePayments[0].amount);
  assert.equal(result.maxInstallment, 14_000_000);
});

test('کارمزد صفر، دوره ناقص و دوره یک‌ماهه جریان نقدی درست دارند', () => {
  const zero = scheduleFee(120_000_000, 0, 12);
  assert.equal(zero.installment, 10_000_000);
  assert.equal(zero.totalInterest, 0);
  assert.equal(zero.payments.length, 12);
  assert.equal(zero.feePayments.length, 0);
  const partial = scheduleFee(300_000_000, 4, 13);
  assert.equal(partial.totalInterest, 12_083_333);
  assert.equal(partial.feePayments[1].month, 13);
  assert.equal(Math.round(partial.payments.reduce((a, b) => a + b, 0)), partial.totalPayment);
  const oneMonth = scheduleFee(300_000_000, 4, 1);
  assert.equal(oneMonth.payments[0], 301_000_000);
  assert.equal(oneMonth.totalInterest, 1_000_000);
});

test('نرخ مؤثر مرکب و هزینه کسر اولیه فقط با ورودی صریح', () => {
  const p = { category: 'loans', rateKind: 'profit', rate: 23, maxAmount: 100_000_000, termMonths: 48 };
  assert.equal(effectiveAnnualRate(p, p.maxAmount, p.termMonths), 25.59);
  assert.equal(effectiveAnnualRate(p, p.maxAmount, p.termMonths, 4), 28.59);
  assert.equal(loanSummary(p).effective, 25.59);
  assert.equal(effectiveAnnualRate(p, p.maxAmount, p.termMonths, 100), null);
  // IRR جریان نامساوی نباید معادل تقسیم کل بر تعداد اقساط باشد.
  assert.notEqual(irrCashflows([50, 10, 10, 10, 10, 10], 90), irrCashflows([100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6], 90));
});

test('اعتبار کارمزدی با مدل نامعلوم و اقساط متغیر ماشین‌حساب فرضی نمی‌گیرند', () => {
  const bnpl = { category: 'credit', rate: 30, rateKind: 'fee', feeModel: 'unknown', maxAmount: 20_000_000, termMonths: 4 };
  assert.equal(scheduleFor(bnpl, 20_000_000, 4), null);
  assert.equal(basisAnnualRate(bnpl), null);
  assert.equal(loanSummary(bnpl), null);
  const irregular = { category: 'loans', rate: 23, rateKind: 'profit', paymentSchedule: 'variable', maxAmount: 1e9, termMonths: 48 };
  assert.equal(scheduleFor(irregular, 1e9, 48), null);
  const once = { category: 'credit', rate: 4, rateKind: 'fee', feeModel: 'one-time' };
  assert.equal(scheduleFor(once, 100_000_000, 12).totalInterest, 4_000_000);
});

test('بازده حقیقی مثبت سپرده به اشتباه جریمه نمی‌شود', () => {
  const result = scoreProduct({ category: 'deposits', rateKind: 'profit', rate: 30, benefit: 50, digital: 50, speed: 50, friction: 50, lastSeen: ago(0) }, DEFAULT_WEIGHTS, { inflation: 10 });
  assert.ok(result.realRate > 0);
  assert.equal(result.adjustment, 0);
});

/* تاریخ مشاهده و snapshots */
test('snapshot تغییرکرده یا بدون تغییر، رکورد موجود را بازنویسی و تازه نمی‌کند', () => {
  const current = { id: 'fund-test', bank: 'بانک تست', product: 'صندوق تست', category: 'funds', autoDiscovered: true, rate: 31, lastUpdated: ago(70), lastSeen: ago(70), stale: false };
  for (const rate of [31, 12]) {
    const snapshot = { ...current, rate, live: false, lastSeen: ago(70) };
    const { merged } = mergeProducts([current], [snapshot]);
    assert.equal(merged[0].rate, 31);
    assert.equal(merged[0].lastSeen, current.lastSeen);
    assert.equal(merged[0].stale, true);
  }
});

test('snapshot تازه، کهنه و بی‌تاریخ برای رکورد جدید بدون مهر جعلی طبقه‌بندی می‌شود', () => {
  const base = { bank: 'بانک تست', category: 'funds', autoDiscovered: true, rate: 25, live: false, lastUpdated: null };
  const incoming = [
    { ...base, id: 'new-fresh', product: 'صندوق تازه', source: { checked: ago(5) } },
    { ...base, id: 'new-old', product: 'صندوق کهنه', source: { checked: ago(70) } },
    { ...base, id: 'new-undated', product: 'صندوق بی‌تاریخ' },
  ];
  const { merged } = mergeProducts([], incoming);
  const byId = Object.fromEntries(merged.map((p) => [p.id, p]));
  assert.equal(byId['new-fresh'].stale, false);
  assert.equal(byId['new-old'].stale, true);
  assert.equal(byId['new-undated'].stale, true);
  for (const p of merged) assert.equal(p.lastSeen, undefined);
});

test('واکشی زنده در برابر snapshot کهنه، مشاهده و نرخ جدید ثبت می‌کند', () => {
  const current = { id: 'live', product: 'وام تست', bank: 'بانک تست', category: 'loans', autoDiscovered: true, rate: 10, lastSeen: ago(100), stale: true };
  const next = { ...current, rate: 14, live: true };
  const { merged } = mergeProducts([current], [next]);
  assert.equal(merged[0].rate, 14);
  assert.equal(merged[0].lastSeen, ago(0));
  assert.equal(merged[0].stale, false);
});

/* پوشش اکتشافی sitemap و تجزیه محافظه‌کار */
test('سهمیه اکتشافی در sitemap ثابت همه صفحات را طی روزهای متوالی پوشش می‌دهد', () => {
  const index = Array.from({ length: 53 }, (_, i) => ({ url: `https://www.rade.ir/loan-cash-loan/${String(i).padStart(3, '0')}-x/`, lastmod: i < 6 ? '2026-10-01' : '2020-01-01' }));
  const visited = new Set();
  const epoch = Date.parse('2026-11-02T00:00:00Z');
  for (let day = 0; day < 30; day++) {
    const dayISO = new Date(epoch + day * 86_400_000).toISOString().slice(0, 10);
    const { selected, rotation } = selectFetchSet(index, { limit: 8, now: epoch, day: dayISO, refreshUrls: [index[0].url, index[52].url, index[52].url] });
    const work = [...selected, ...rotation].map((x) => x.url);
    assert.equal(selected.length, 8);
    assert.equal(new Set(work).size, work.length);
    selected.forEach((x) => visited.add(x.url));
  }
  assert.equal(visited.size, index.length);
});

const page = (rate, desc, guarantee = 'اعتبارسنجی') => `<table>
<tr><td>نام وام</td><td>وام نمونه</td></tr><tr><td>بانک</td><td>بانک نمونه</td></tr>
<tr><td>نرخ سود وام</td><td>${rate}</td></tr><tr><td>سقف وام</td><td>100 میلیون تومان</td></tr>
<tr><td>حداکثر زمان بازپرداخت</td><td>60 ماه</td></tr><tr><td>نوع ضمانت</td><td>${guarantee}</td></tr>
<tr><td>توضیحات</td><td>${desc}</td></tr></table>`;

test('نرخ کم الزاماً کارمزد نیست و صفر صریح از نرخ نامشخص جداست', () => {
  const profit = mapToProduct('https://www.rade.ir/loan-cash-loan/1-test/', page('۵٪', 'نرخ سود این تسهیلات ۵ درصد است.'));
  assert.equal(profit.rateKind, 'profit');
  const unknown = mapToProduct('https://www.rade.ir/loan-interest-free-loan/2-test/', page('نامشخص', 'تسهیلات بر اساس معدل حساب است.'));
  assert.equal(unknown.rateKnown, false);
  assert.equal(unknown.lastUpdated, null);
  const zero = mapToProduct('https://www.rade.ir/loan-interest-free-loan/3-test/', page('نامشخص', 'کارمزد آن صفر درصد است.'));
  assert.equal(zero.rateKnown, true);
  assert.equal(zero.rate, 0);
  assert.equal(zero.rateKind, 'fee');
  const fee = mapToProduct('https://www.rade.ir/loan-interest-free-loan/4-test/', page('۴٪<br>بدون سود و با کارمزد ۲ تا ۴ درصد', 'تسهیلات قرض الحسنه است.'));
  assert.equal(fee.rateKind, 'fee');
});

test('تجزیه ضمانت منفی و نامعلوم به اشتباه ضامن‌دار یا بدون ضامن نمی‌شود', () => {
  const url = 'https://www.rade.ir/loan-cash-loan/1-test/';
  assert.equal(mapToProduct(url, page('۲۳٪', '', 'بدون ضامن، اعتبارسنجی')).collateralKind, 'credit-score');
  assert.equal(mapToProduct(url, page('۲۳٪', '', 'ضامن رسمی')).collateralKind, 'guarantor');
  assert.equal(mapToProduct(url, page('۲۳٪', '', '')).collateralKind, 'mixed');
});

/* شاخص‌ها */
test('تنها مشاهده معتبر، تاریخ‌دار و جدیدتر همراه با همان منبع ادغام می‌شود', () => {
  assert.ok(macroPeriodIndex('آبان ۱۴۰۵') > macroPeriodIndex('مهر ۱۴۰۵'));
  assert.equal(macroPeriodIndex('نامشخص'), null);
  const base = { indicators: { inflationAnnual: { value: 76.8, period: 'مهر ۱۴۰۵', source: { url: 'https://old.example/' } }, depositCap1y: { value: 20.5 } }, derived: {} };
  const f = (period, annual, trustedForInflation, url) => ({ inflation: { period, annual }, trustedForInflation, url, label: 'منبع دوره', kind: 'regulator', rates: { depositCap1y: 99 } });
  const opts = { todayJalali: { jy: 1405, jm: 8 }, now: '2026-11-02T00:00:00Z' };
  const unsafe = [f(null, 80, true, 'https://example.com/no-period'), f('شهریور ۱۴۰۵', 60, true, 'https://example.com/old'), f('آبان ۱۴۰۵', 81, false, 'https://example.com/home'), f('آذر ۱۴۰۵', 85, true, 'https://example.com/future')];
  const kept = mergeMacroObservations(base, unsafe, opts);
  assert.equal(kept.indicators.indicators.inflationAnnual.value, 76.8);
  assert.equal(kept.indicators.indicators.depositCap1y.value, 20.5);
  assert.equal(kept.indicators.derived.realDepositReturnAnnual, -31.8);
  const updated = mergeMacroObservations(base, [...unsafe, f('آبان ۱۴۰۵', 80.2, true, 'https://example.com/new')], opts);
  assert.equal(updated.indicators.indicators.inflationAnnual.value, 80.2);
  assert.equal(updated.indicators.indicators.inflationAnnual.source.url, 'https://example.com/new');
  assert.equal(updated.indicators.indicators.inflationAnnual.period, 'آبان ۱۴۰۵');
  assert.equal(base.indicators.inflationAnnual.value, 76.8);
});

test('هشدار سپرده فقط دوره یک‌ساله را با مرجع همان دوره مقایسه می‌کند', () => {
  const records = [
    { id: 'one', bank: 'آ', product: 'سپرده عادی', category: 'deposits', termMonths: 12, rate: 21 },
    { id: 'two', bank: 'ب', product: 'سپرده دوساله', category: 'deposits', termMonths: 24, rate: 21.5 },
    { id: 'unknown', bank: 'پ', product: 'سپرده', category: 'deposits', rate: 22 },
  ];
  const anomalies = detectAnomalies(records, { indicators: { depositCap1y: { value: 20.5 } } });
  assert.deepEqual(anomalies.filter((a) => a.id === 'cbi-deposit-cap-exceeded').map((a) => a.productId), ['one']);
});

/* نمای کاربر و داده‌های اصلاح‌شده */
test('رابط صفر واقعی را نمایش می‌دهد، نرخ نامعلوم پیش‌فرض ساختگی نمی‌گیرد', () => {
  const base = { id: 'z', bank: 'بانک تست', product: 'وام تست', category: 'loans', rate: 0, rateKind: 'fee', maxAmount: 100_000_000, termMonths: 12 };
  const known = normalizeProduct({ ...base, rateKnown: true }, 0);
  const unknown = normalizeProduct({ ...base, id: 'u', rateKnown: false, rateLabel: 'نامشخص' }, 1);
  assert.match(cardHTML(known), /<span class="v num">۰٪<\/span>/);
  assert.match(detailHTML(known), /data-calc-input="rate"[^>]*value="0"/s);
  assert.match(detailHTML(unknown), /data-calc-input="rate"[^>]*value=""/s);
  assert.doesNotMatch(detailHTML(unknown), /۲۳ درصد پیش‌فرض/);
  assert.match(detailHTML(known), /هزینه کسر از اصل \(٪، اختیاری\)/);
});

test('محصول تاریخی هشدار دارد، در رتبه‌بندی شرکت نمی‌کند و صندوق مستقل باقی می‌ماند', async () => {
  const dataset = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
  const bank = normalizeProduct(dataset.products.find((p) => p.id === 'ayandeh-shetab-23'), 0);
  const fund = normalizeProduct(dataset.products.find((p) => p.id === 'fund-sayand-ayandeh'), 1);
  assert.equal(bank.availability, 'historical');
  assert.notEqual(fund.availability, 'historical');
  assert.match(cardHTML(bank), /تاریخی؛ عرضه جدید تأیید نشده/);
  assert.match(detailHTML(bank), /گزیر/);
  const oldCategory = store.filters.category;
  store.filters.category = bank.category;
  assert.doesNotMatch(rankHTML([bank]), /data-action="detail"/);
  store.filters.category = oldCategory;
});

test('فیلتر بدون ضامن، محصول مختلط و نامعلوم را وارد نتیجه نمی‌کند', () => {
  const savedProducts = store.products;
  const savedFilters = { ...store.filters };
  store.products = [
    normalizeProduct({ id: 'a', bank: 'الف', product: 'با ضامن', category: 'loans', collateralKind: 'guarantor' }, 0),
    normalizeProduct({ id: 'b', bank: 'ب', product: 'نامعلوم', category: 'loans', collateralKind: 'mixed' }, 1),
    normalizeProduct({ id: 'c', bank: 'پ', product: 'بی‌ضامن', category: 'loans', collateralKind: 'credit-score' }, 2),
  ];
  Object.assign(store.filters, { category: 'loans', collateral: 'no-guarantor', contract: 'all', bank: 'all', query: '', confidence: 'all', minScore: 0, channel: 'all', onlyFresh: false, onlyStale: false });
  assert.deepEqual(filtered().map((p) => p.id), ['c']);
  store.products = savedProducts;
  Object.assign(store.filters, savedFilters);
});

test('چهار محصول افزوده و اصلاح به‌جا و شاخص‌ها در منبع حقیقت ثبت‌اند', async () => {
  const dataset = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
  const indicators = JSON.parse(await fs.readFile(path.join(root, 'data/indicators.json'), 'utf8'));
  const byId = Object.fromEntries(dataset.products.map((p) => [p.id, p]));
  for (const id of ['rade-704672', 'rade-704772', 'rade-704924', 'rade-704874']) {
    assert.ok(byId[id]);
    assert.equal(byId[id].source.kind, 'aggregator');
    assert.equal(byId[id].lastUpdated, null);
    assert.equal(byId[id].source.checked, '2026-11-02');
    assert.equal(byId[id].ceilingContingent, true);
  }
  assert.equal(byId['rade-704924'].paymentSchedule, 'variable');
  assert.match(byId['blu-loan-beja'].desc, /۲۰۰ میلیون تومان بدون ضامن/);
  assert.match(byId['blu-loan-beja'].desc, /۴۰۰ میلیون تومان با ضامن/);
  assert.equal(byId['rade-708812'].contractType, 'unknown');
  assert.equal(indicators.indicators.depositCap1y.value, 20.5);
  assert.equal(indicators.indicators.inflationAnnual.value, 76.8);
  assert.equal(indicators.derived.realDepositReturnAnnual, -31.8);
});

/* نگهبان‌های توسعه و ساخت */
test('درگاه نوشتنی فقط JSON هم‌مبدأ را می‌پذیرد، از جمله پشت پروکسی', () => {
  const req = (headers) => ({ headers, socket: {} });
  assert.equal(sameOriginPost(req({ host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json' })), true);
  assert.equal(sameOriginPost(req({ host: 'internal:4173', 'x-forwarded-host': '4173-preview.example', 'x-forwarded-proto': 'https', origin: 'https://4173-preview.example', 'content-type': 'application/json; charset=utf-8' })), true);
  assert.equal(sameOriginPost(req({ host: 'localhost:4173', origin: 'https://evil.example', 'content-type': 'application/json' })), false);
  assert.equal(sameOriginPost(req({ host: 'localhost:4173', 'content-type': 'application/json' })), false);
  assert.equal(sameOriginPost(req({ host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'text/plain' })), false);
});

test('سرور واقعاً درخواست نوشتنی بیگانه را رد و CORS باز اعلام نمی‌کند', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const denied = await fetch(`${base}/api/refresh`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const status = await fetch(`${base}/api/status`);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('access-control-allow-origin'), null);
    const options = await fetch(`${base}/api/refresh`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    assert.equal(options.status, 405);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('پاک‌سازی خروجی ساخت هرگز ریشه، منابع یا خارج مخزن را هدف نمی‌گیرد', async () => {
  for (const dir of [root, path.join(root, '.git'), path.join(root, 'assets'), path.join(root, 'data', 'custom'), path.dirname(root)]) {
    await assert.rejects(validateOutputPath(dir));
  }
  const custom = await fs.mkdtemp(path.join(root, 'bankradar-test-output-'));
  try {
    await fs.writeFile(path.join(custom, 'user-file.txt'), 'keep');
    await assert.rejects(validateOutputPath(custom));
    assert.equal(await fs.readFile(path.join(custom, 'user-file.txt'), 'utf8'), 'keep');
  } finally {
    await fs.rm(custom, { recursive: true, force: true });
  }
});

test('تاریخ ساخت داده جدید با زمان آخرین اجرای خط لوله خلط نمی‌شود', async () => {
  const { loadData, reloadFreshData } = await import('../assets/js/store.js');
  const originalFetch = globalThis.fetch;
  const originalBundle = globalThis.__BANK_RADAR__;
  const record = { id: 'sample', bank: 'بانک تست', product: 'وام تست', category: 'loans', rate: 23, rateKind: 'profit', maxAmount: 100_000_000, termMonths: 12 };
  globalThis.__BANK_RADAR__ = { products: [record], banks: [], indicators: { inflationAnnual: { value: 60 } }, meta: { generatedAt: '2026-10-01T00:00:00Z', lastRun: '2026-10-01T00:00:00Z' } };
  globalThis.fetch = async (url) => {
    const name = String(url).split('?')[0];
    const files = {
      'data/products.json': { generatedAt: '2026-11-02T00:00:00Z', counts: { total: 1 }, products: [record] },
      'data/meta.json': { lastRun: '2026-11-01T10:41:23Z', counts: { total: 999 }, sources: [] },
      'data/indicators.json': { indicators: { inflationAnnual: { value: 76.8 } }, period: 'مهر ۱۴۰۵' },
      'data/banks.json': { banks: [] },
    };
    return files[name] ? { ok: true, json: async () => files[name] } : { ok: false };
  };
  try {
    await loadData();
    assert.equal(store.meta.generatedAt, '2026-11-02T00:00:00Z');
    assert.equal(store.meta.lastRun, '2026-11-01T10:41:23Z');
    assert.equal(store.meta.counts.total, 1);
    assert.equal(store.indicators.inflationAnnual.value, 76.8);
    await reloadFreshData();
    assert.equal(store.meta.lastRun, '2026-11-01T10:41:23Z');
    assert.equal(store.meta.counts.total, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__BANK_RADAR__ = originalBundle;
  }
});

test('سلامت داده از محصولات فعلی حساب می‌شود نه گزارش هفتگی قدیمی', async () => {
  const { summary } = await import('../assets/js/store.js');
  const products = store.products;
  const weekly = store.weeklyReport;
  try {
    store.products = [{ id: 'old', bank: 'بانک تست', category: 'loans', stale: true, confidence: 'low' }];
    store.weeklyReport = { stats: { healthScore: 100 } };
    assert.equal(summary().health, 0);
  } finally {
    store.products = products;
    store.weeklyReport = weekly;
  }
});

test('نمایش درصد با دقت درخواستی نرخ مؤثر را گرد نمی‌کند', async () => {
  const { faPercent } = await import('../assets/js/util.js');
  assert.equal(faPercent(4.48, 2), '۴.۴۸٪');
  assert.equal(faPercent(4.04, 2), '۴.۰۴٪');
});


test('ساخت آفلاین تاریخ گردآوری، منابع و داده اصلی را دست‌نخورده نگه می‌دارد', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bankradar-offline-'));
  try {
    await fs.cp(path.join(root, 'tools'), path.join(tmp, 'tools'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'data'));
    const files = ['products.json', 'indicators.json', 'banks.json', 'meta.json'];
    for (const file of files) await fs.copyFile(path.join(root, 'data', file), path.join(tmp, 'data', file));
    const before = await Promise.all(files.map((file) => fs.readFile(path.join(tmp, 'data', file), 'utf8')));
    await promisify(execFile)(process.execPath, [path.join(tmp, 'tools', 'collect.mjs'), '--offline'], { cwd: tmp });
    const after = await Promise.all(files.map((file) => fs.readFile(path.join(tmp, 'data', file), 'utf8')));
    assert.deepEqual(after, before);
    const bundle = await fs.readFile(path.join(tmp, 'data', 'bundle.js'), 'utf8');
    const window = {};
    new Function('window', bundle)(window);
    const meta = JSON.parse(before[3]);
    assert.equal(window.__BANK_RADAR__.meta.lastRun, meta.lastRun);
    assert.equal(window.__BANK_RADAR__.meta.lastRunMode, meta.lastRunMode);
    assert.deepEqual(window.__BANK_RADAR__.meta.sources, meta.sources);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('شاخص و فهرست بانک مستقل از زمان محصولات به‌روز و از بازگشت به نسخه قدیمی محافظت می‌شوند', async () => {
  const { loadData, reloadFreshData } = await import('../assets/js/store.js');
  const originalFetch = globalThis.fetch;
  const originalBundle = globalThis.__BANK_RADAR__;
  const item = { id: 'one', bank: 'نمونه', product: 'وام', category: 'loans', rate: 23, rateKind: 'profit', termMonths: 12, maxAmount: 100_000_000 };
  const buildTime = '2026-11-02T00:00:00Z';
  globalThis.__BANK_RADAR__ = {
    products: [item], banks: [{ id: 'old' }], indicators: { inflationAnnual: { value: 60 } },
    meta: { generatedAt: buildTime, lastRun: '2026-11-01T00:00:00Z', indicatorsGeneratedAt: '2026-10-01T00:00:00Z', banksGeneratedAt: '2026-10-01T00:00:00Z' },
  };
  const files = {
    'data/products.json': { generatedAt: buildTime, products: [item] },
    'data/indicators.json': { generatedAt: '2026-11-01T00:00:00Z', indicators: { inflationAnnual: { value: 76.8 } } },
    'data/banks.json': { generatedAt: '2026-11-01T00:00:00Z', banks: [{ id: 'fresh' }] },
    'data/meta.json': { lastRun: '2026-11-01T00:00:00Z' },
  };
  globalThis.fetch = async (url) => {
    const data = files[String(url).split('?')[0]];
    return data ? { ok: true, json: async () => data } : { ok: false };
  };
  try {
    await loadData();
    assert.equal(store.indicators.inflationAnnual.value, 76.8);
    assert.equal(store.banks[0].id, 'fresh');
    assert.equal(store.meta.generatedAt, buildTime);
    // بارگذاری عادی نباید نسخه مستقل قدیمی‌تر را جای بسته جدید بنشاند.
    files['data/indicators.json'].generatedAt = '2026-09-01T00:00:00Z';
    files['data/banks.json'].generatedAt = '2026-09-01T00:00:00Z';
    await loadData();
    assert.equal(store.indicators.inflationAnnual.value, 60);
    assert.equal(store.banks[0].id, 'old');
    // بازخوانی اجباری هم باید فهرست بانک‌های منتشرشده را واکشی کند.
    await reloadFreshData();
    assert.equal(store.banks[0].id, 'fresh');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__BANK_RADAR__ = originalBundle;
  }
});

test('دروازه اعتبارسنجی مقادیر نامعتبر نوع عقد، منبع و نرخ را رد می‌کند', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bankradar-schema-'));
  try {
    await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'tools', 'lib'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
    await fs.copyFile(path.join(root, 'scripts/validate-data.mjs'), path.join(tmp, 'scripts/validate-data.mjs'));
    await fs.copyFile(path.join(root, 'tools/lib/parse.mjs'), path.join(tmp, 'tools/lib/parse.mjs'));
    for (const file of ['schema.json', 'indicators.json', 'banks.json']) {
      await fs.copyFile(path.join(root, 'data', file), path.join(tmp, 'data', file));
    }
    const dataset = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
    dataset.products[0].contractType = 'morabehe';
    dataset.products[0].source.kind = 'official';
    dataset.products[0].rateKnown = 'true';
    await fs.writeFile(path.join(tmp, 'data/products.json'), JSON.stringify(dataset));
    await assert.rejects(
      promisify(execFile)(process.execPath, [path.join(tmp, 'scripts/validate-data.mjs')], { cwd: tmp }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /contractType/);
        assert.match(error.stderr, /نوع منبع/);
        assert.match(error.stderr, /rateKnown/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

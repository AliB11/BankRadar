/**
 * آزمون منبع آی‌سیگنال (صندوق‌های درآمد ثابت).
 *
 * چرا با برش ثابت؟ جدول isignal.ir/fund/ سمت کاربر رندر می‌شود و API آن در
 * CI همیشه در دسترس نیست. برش tests/fixtures/isignal-funds-1405-07-05.json
 * همان داده‌ای است که از صفحهٔ مقایسهٔ آی‌سیگنال برداشته شده؛ آزمون‌ها
 * تضمین می‌کنند نگاشت ردیف → رکورد با طرح‌وارهٔ سامانه و قواعد ادغام سازگار
 * بماند و رکوردهای دست‌نویس فقط «به‌روزرسانی سبک» بگیرند.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_FUNDS,
  FIXED_INCOME_TYPES,
  normalizeRow,
  rejectReason,
  mapFundToProduct,
  collect,
  fundBenefit,
  rowDateToIso,
  fundPageUrl,
  shortFundName,
  tidyFundTitle,
  productTitle,
  tidyManager,
  faToman,
  faNavToman,
} from '../tools/sources/isignal.mjs';
import { mergeProducts } from '../tools/collect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/isignal-funds-1405-07-05.json');
const snapshot = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const banks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/banks.json'), 'utf8')).banks;
const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8')).products;
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/schema.json'), 'utf8'));

const TODAY = '2026-09-28';
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** رکوردهای دست‌نویس پیش از درون‌ریزی (شبیه‌سازی پایگاه قبل از افزودن صندوق‌های آی‌سیگنال) */
const curatedBase = products.filter((p) => p.category !== 'funds' || p.autoDiscovered !== true);

function findProductSchema(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.properties?.rateKind && node.properties?.category) return node;
  for (const v of Object.values(node)) {
    const hit = findProductSchema(v);
    if (hit) return hit;
  }
  return null;
}
const productSchema = findProductSchema(schema);

/* ------------------------------------------------------------------ */
/* ابزارها                                                             */
/* ------------------------------------------------------------------ */

test('تبدیل تاریخ ردیف: شمسی، ارقام فارسی و ISO میلادی', () => {
  assert.equal(rowDateToIso('1405/07/05'), '2026-09-27');
  assert.equal(rowDateToIso('1405/07/04'), '2026-09-26');
  assert.equal(rowDateToIso('۱۴۰۵/۰۶/۰۸'), '2026-08-30');
  assert.equal(rowDateToIso('1405-05-30'), '2026-08-21');
  assert.equal(rowDateToIso('2026-09-27T00:00:00Z'), '2026-09-27');
  assert.equal(rowDateToIso(''), null);
  assert.equal(rowDateToIso('نامعلوم'), null);
});

test('نام کوتاه صندوق و املای مدیر یکدست می‌شود', () => {
  assert.equal(shortFundName('در اوراق بهادار با درآمد ثابت کاردان'), 'کاردان');
  assert.equal(shortFundName('ثابت حامی یکم مفید'), 'حامی یکم مفید');
  assert.equal(shortFundName('با درآمد ثابت کمند'), 'کمند');
  assert.equal(shortFundName('مشترک آسمان سهند'), 'مشترک آسمان سهند');
  assert.equal(tidyManager('تامین سرمایه لوتوس پارسیان'), 'تأمین سرمایه لوتوس پارسیان');
  assert.equal(tidyManager('مشاور سرمایه گذاری ترنج'), 'مشاور سرمایه‌گذاری ترنج');
  assert.equal(tidyManager('مشاور سرمایه‌گذاری فراز ایده نوآفرین تک (فاینتک)'), 'مشاور سرمایه‌گذاری فراز ایده نوآفرین تک');
});

test('نشانی صفحهٔ صندوق در آی‌سیگنال با الگوی /fund/<عنوان>/ ساخته می‌شود', () => {
  assert.equal(fundPageUrl('یارا'), 'https://isignal.ir/fund/%DB%8C%D8%A7%D8%B1%D8%A7/');
  assert.equal(decodeURIComponent(fundPageUrl('ثبات نوید')), 'https://isignal.ir/fund/ثبات-نوید/');
});

test('قالب‌بندی مبالغ فارسی', () => {
  assert.equal(faToman(13724), '۱۳.۷ هزار تومان');
  assert.equal(faToman(101233), '۱۰۱.۲ هزار تومان');
  assert.equal(faToman(950), '۹۵۰ تومان');
  assert.equal(faNavToman(1297260.28), '۱۲۹.۷ هزار میلیارد تومان');
  assert.equal(faNavToman(755), '۷۵.۵ میلیارد تومان');
  assert.equal(faNavToman(0), null);
});

test('امتیاز سود صندوق یکنوا و در بازهٔ منطقی است', () => {
  assert.ok(fundBenefit(27) < fundBenefit(30));
  assert.ok(fundBenefit(30) < fundBenefit(38));
  assert.ok(fundBenefit(38) < fundBenefit(43));
  assert.equal(fundBenefit(27), 70);
  assert.ok(fundBenefit(100) <= 95 && fundBenefit(0) >= 40);
  assert.equal(fundBenefit('x'), 55);
});

/* ------------------------------------------------------------------ */
/* نرمال‌سازی ردیف                                                     */
/* ------------------------------------------------------------------ */

test('ردیف API (return.oneYear / buyPrice / typeId) و ردیف برش هر دو یک شکل می‌شوند', () => {
  const api = normalizeRow({
    id: 5141,
    name: 'یارا',
    date: '1405/07/05',
    return: { oneYear: 42.79, sixMonth: 21.33, threeMonth: 10.85, oneMonth: 3.36, oneWeek: 0.67 },
    buyPrice: 36267,
    manager: 'سبد گردان آریا',
    typeId: 43,
  });
  assert.equal(api.etf, true);
  assert.equal(api.oneYear, 42.79);
  assert.equal(api.issuePrice, 36267);
  assert.equal(api.manager, 'سبدگردان آریا');
  assert.equal(api.date, '1405/07/05');

  const snap = normalizeRow(snapshot.rows.find((r) => r.id === 5141));
  assert.equal(snap.etf, true);
  assert.equal(snap.oneYear, api.oneYear);
  assert.equal(snap.site, 'https://fund1.ariaamc.ir');
  assert.equal(snap.guarantor, null, '«ندارد» باید به null تبدیل شود');
});

test('صندوق‌های غیر درآمد ثابت، نوپا یا بدون بازدهی رد می‌شوند', () => {
  assert.equal(rejectReason(normalizeRow({ id: 1, name: 'سهامی', manager: 'x', typeId: 1, return: { oneYear: 120 } })).includes('درآمد ثابت'), true);
  assert.match(rejectReason(normalizeRow({ id: 2, name: 'نوپا', manager: 'x', typeId: 43, return: { oneYear: 0 } })), /خارج از بازه/);
  assert.match(rejectReason(normalizeRow({ id: 3, name: 'بی‌داده', manager: 'x', typeId: 30 })), /ندارد/);
  assert.equal(rejectReason(normalizeRow({ id: 4, name: 'خوب', manager: 'x', typeId: 30, return: { oneYear: 31 } })), null);
  assert.equal(normalizeRow(null), null);
  assert.equal(normalizeRow({ name: 'بدون شناسه' }), null);
});

/* ------------------------------------------------------------------ */
/* نگاشت به رکورد                                                      */
/* ------------------------------------------------------------------ */

test('برش ثابت ۶۷ صندوق درآمد ثابت دارد و همهٔ شناسه‌ها در جدول شناخت هستند', () => {
  assert.equal(snapshot.rows.length, 67);
  const ids = snapshot.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'شناسهٔ تکراری در برش');
  for (const r of snapshot.rows) {
    assert.ok(KNOWN_FUNDS[r.id], `صندوق ${r.id} (${r.name}) در KNOWN_FUNDS نیست`);
    assert.ok(FIXED_INCOME_TYPES[r.typeId], `نوع ${r.typeId} برای ${r.name}`);
  }
});

test('جدول شناخت: slugها یکتا، bankIdها موجود در banks.json، existingId ها واقعی', () => {
  const slugs = Object.values(KNOWN_FUNDS).map((m) => m.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slug تکراری');
  const bankIds = new Set(banks.map((b) => b.id));
  const productIds = new Set(products.map((p) => p.id));
  for (const [id, meta] of Object.entries(KNOWN_FUNDS)) {
    assert.match(`fund-${meta.slug}`, ID_RE, `slug نامعتبر برای ${id}`);
    assert.ok(bankIds.has(meta.bankId), `bankId «${meta.bankId}» (صندوق ${id}) در banks.json نیست`);
    assert.ok(['monthly', 'none'].includes(meta.payout), `payout نامعتبر برای ${id}`);
    if (meta.existingId) assert.ok(productIds.has(meta.existingId), `existingId «${meta.existingId}» وجود ندارد`);
  }
});

test('رکورد تازه (ETF) با طرح‌واره و قراردادهای سامانه هم‌خوان است', () => {
  const row = normalizeRow(snapshot.rows.find((r) => r.id === 5141));
  const p = mapFundToProduct(row, { banks, existing: curatedBase, today: TODAY });

  assert.equal(p.id, 'fund-yara-aria');
  assert.match(p.id, ID_RE);
  assert.equal(p.category, 'funds');
  assert.equal(p.subcategory, 'etf');
  assert.equal(p.bankId, 'aria');
  assert.equal(p.bank, 'سبدگردان آریا');
  assert.equal(p.rate, 42.79);
  assert.equal(p.rateKind, 'profit');
  assert.equal(p.collateralKind, 'none');
  assert.equal(p.confidence, 'medium');
  assert.equal(p.autoDiscovered, true);
  assert.equal(p.regulatory, true);
  assert.equal(p.lastUpdated, '2026-09-27');
  assert.equal(p.lastSeen, TODAY);
  assert.equal(p.lastVerified, TODAY);
  assert.equal(p.source.kind, 'aggregator');
  assert.equal(p.source.checked, TODAY);
  assert.match(p.source.url, /^https:\/\/isignal\.ir\/fund\//);
  assert.equal(p.tags[0], 'صندوق درآمد ثابت');
  assert.ok(p.tags.includes('ETF'));
  assert.ok(p.tags.includes('بدون تقسیم سود'));
  assert.match(p.rateLabel, /^بازدهی یک‌ساله ۴۲\.۷۹٪/);
  assert.match(p.rateLabel, /آی‌سیگنال ۱۴۰۵\/۰۷\/۰۵/);
  assert.match(p.product, /^صندوق درآمد ثابت یارا \(ETF\)$/);
  assert.match(p.desc, /سبدگردان آریا/);
  assert.match(p.desc, /۴۲\.۷۹٪/);
  assert.match(p.desc, /بازدهی گذشته تضمین‌کنندهٔ بازدهی آینده نیست/);
  assert.equal(p.extra.isignalId, 5141);
  assert.equal(p.extra.symbol, 'یارا');
  assert.equal(p.extra.returns.oneYear, 42.79);
  assert.equal(p.extra.payout, 'none');
  assert.equal(p.minAmount, 3623, 'حداقل = قیمت یک واحد به تومان');

  // ارقام فارسی فقط در برچسب‌ها؛ فیلدهای عددی ASCII
  assert.equal(typeof p.rate, 'number');
  assert.equal(typeof p.benefit, 'number');
  assert.doesNotMatch(String(p.rate), /[۰-۹]/);

  // با طرح‌واره: هر فیلد enum در مقادیر مجاز
  for (const key of ['rateKind', 'collateralKind', 'confidence']) {
    const allowed = productSchema.properties[key].enum;
    assert.ok(allowed.includes(p[key]), `${key}=${p[key]} در ${allowed}`);
  }
  assert.ok(productSchema.properties.source.properties.kind.enum.includes(p.source.kind));
});

test('رکورد تازه (صدور و ابطالی با ضامن بانکی) نام بانک/مدیر و ضامن را درست می‌آورد', () => {
  const row = normalizeRow(snapshot.rows.find((r) => r.id === 323));
  const p = mapFundToProduct(row, { banks, existing: curatedBase, today: TODAY });

  assert.equal(p.id, 'fund-kardan-tejarat');
  assert.equal(p.subcategory, 'issuance-redemption');
  assert.equal(p.bankId, 'tejarat');
  assert.equal(p.bank, 'بانک تجارت / تأمین سرمایه کاردان');
  assert.equal(p.product, 'صندوق درآمد ثابت کاردان (صدور و ابطالی)');
  assert.equal(p.lastUpdated, '2026-09-26', 'تاریخ داده ۱۴۰۵/۰۷/۰۴');
  assert.match(p.collateral, /ضامن نقدشوندگی: بانک تجارت/);
  assert.ok(p.tags.includes('ضامن نقدشوندگی'));
  assert.ok(p.tags.includes('تقسیم سود ماهانه'));
  assert.equal(p.extra.guarantor, 'بانک تجارت');
  assert.equal(p.friction, 90, 'ضامن بانکی اصطکاک کمتری دارد');
  assert.ok(p.requirements.some((r) => r.includes('iran-kfunds1.ir')));
  assert.equal(p.minAmount, 101233);
});

test('صندوق دست‌نویس فقط «به‌روزرسانی سبک» می‌گیرد: متن و منبع رسمی دست نمی‌خورد', () => {
  const row = normalizeRow(snapshot.rows.find((r) => r.id === 5061)); // افران
  const curated = curatedBase.find((p) => p.id === 'fund-afran-toranj');
  assert.ok(curated, 'رکورد دست‌نویس افران باید موجود باشد');

  const slim = mapFundToProduct(row, { banks, existing: curatedBase, today: TODAY });
  assert.equal(slim.id, 'fund-afran-toranj');
  assert.equal(slim.product, curated.product, 'نام محصول دست‌نویس حفظ می‌شود');
  assert.equal(slim.bank, curated.bank);
  assert.equal(slim.rate, 41.97);
  assert.equal(slim.autoDiscovered, undefined, 'نباید پرچم خودکار بگیرد');
  assert.equal(slim.desc, undefined);
  assert.equal(slim.source, undefined);
  assert.equal(slim.confidence, undefined);
  assert.equal(slim.extra.isignal.isignalId, 5061);

  // پس از ادغام: نرخ/برچسب تازه، اما منبع، اطمینان و توضیحات دست‌نویس محفوظ
  const { merged, stats } = mergeProducts(curatedBase, [slim]);
  assert.equal(stats.added, 0);
  const after = merged.find((p) => p.id === 'fund-afran-toranj');
  assert.equal(after.rate, 41.97);
  assert.match(after.rateLabel, /آی‌سیگنال/);
  assert.equal(after.desc, curated.desc);
  assert.equal(after.source.url, curated.source.url);
  assert.equal(after.confidence, curated.confidence);
  assert.equal(after.autoDiscovered, curated.autoDiscovered);
  assert.equal(after.extra.isignal.symbol, 'افران');
});

test('در نبود جدول شناخت، شناسهٔ پایدار fund-isignal-<id> و bankId لاتین ساخته می‌شود', () => {
  const row = normalizeRow({
    id: 999999,
    name: 'صندوق آزمایشی',
    manager: 'سبدگردان ناشناخته',
    typeId: 30,
    return: { oneYear: 31.5 },
    buyPrice: 1000000,
    date: '1405/07/05',
  });
  const p = mapFundToProduct(row, { banks, existing: [], today: TODAY });
  assert.equal(p.id, 'fund-isignal-999999');
  assert.match(p.bankId, ID_RE, `bankId «${p.bankId}» باید لاتین باشد`);
  assert.equal(p.bank, 'سبدگردان ناشناخته');
  assert.equal(p.amountLabel.includes('۱۰۰ هزار تومان'), true);
  assert.doesNotMatch(p.desc, /undefined|null|NaN/);
});

test('تاریخ آیندهٔ منبع به امروز محدود می‌شود تا اعتبارسنجی سرخ نشود', () => {
  const row = normalizeRow({ id: 5, name: 'آینده', manager: 'x', typeId: 43, return: { oneYear: 30 }, date: '1410/01/01' });
  const p = mapFundToProduct(row, { banks, existing: [], today: TODAY });
  assert.equal(p.lastUpdated, TODAY);
});

/* ------------------------------------------------------------------ */
/* جمع‌آوری از برش و ادغام کامل                                        */
/* ------------------------------------------------------------------ */

test('collect با برش: ۶۷ محصول، ۳۸ ETF، ۸ به‌روزرسانی دست‌نویس، بدون شناسهٔ تکراری', async () => {
  const logs = [];
  const result = await collect({ existing: curatedBase, banks, snapshot: FIXTURE, today: TODAY, log: (m) => logs.push(m) });
  assert.equal(result.source, 'isignal.ir');
  assert.match(result.origin, /^snapshot:/);
  assert.equal(result.rows, 67);
  assert.equal(result.products.length, 67);
  assert.equal(result.etf, 38);
  assert.equal(result.issuance, 29);
  assert.equal(result.refreshed, 8);
  assert.equal(result.skipped.length, 0);
  assert.ok(logs.some((m) => m.includes('آی‌سیگنال')));

  const ids = result.products.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of result.products) {
    assert.match(p.id, ID_RE);
    assert.ok(p.rate >= 25 && p.rate <= 45, `نرخ نامعقول ${p.id}: ${p.rate}`);
    assert.ok(p.lastUpdated <= TODAY);
    assert.match(p.rateLabel, /بازدهی یک‌ساله/);
  }

  // ادغام روی پایگاه دست‌نویس: ۵۹ افزوده + ۸ به‌روزرسانی، مجموع صندوق‌ها ۶۷
  const { merged, stats } = mergeProducts(curatedBase, result.products);
  assert.equal(stats.added, 59);
  // ۸ رکورد دست‌نویس یا به‌روز می‌شوند یا (اگر داده‌های فعلی همین برش باشد) بی‌تغییر می‌مانند
  assert.equal(stats.updated + stats.unchanged, 8);
  const funds = merged.filter((p) => p.category === 'funds');
  assert.equal(funds.length, 67);
  const bankIds = new Set(banks.map((b) => b.id));
  for (const f of funds) {
    assert.ok(bankIds.has(f.bankId), `bankId «${f.bankId}» برای ${f.id} در banks.json نیست`);
    assert.ok(['etf', 'issuance-redemption'].includes(f.subcategory), `subcategory ${f.id}`);
    assert.equal(f.tags[0], 'صندوق درآمد ثابت');
    assert.equal(f.category, 'funds');
    assert.equal(f.collateralKind, 'none');
  }
});

test('اجرای دوباره روی همان برش، تغییری ایجاد نمی‌کند (ایدمپوتنت)', async () => {
  const first = await collect({ existing: curatedBase, banks, snapshot: FIXTURE, today: TODAY });
  const { merged } = mergeProducts(curatedBase, first.products);
  const second = await collect({ existing: merged, banks, snapshot: FIXTURE, today: TODAY });
  const { stats } = mergeProducts(merged, second.products);
  assert.equal(stats.added, 0, 'نباید رکورد تازه بسازد');
  // رکوردهای خودکار: هیچ تغییری؛ رکوردهای دست‌نویس: در ادغام دوم فقط تاریخ‌های کنترلی به‌روز می‌شوند
  assert.ok(stats.unchanged >= 59, `انتظار ≥۵۹ بی‌تغییر، دریافت ${stats.unchanged}`);
});

test('داده‌های فعلی products.json با خروجی برش هم‌خوان است (۶۷ صندوق، همان نرخ‌ها)', () => {
  const funds = products.filter((p) => p.category === 'funds');
  assert.equal(funds.length, 67);
  for (const r of snapshot.rows) {
    const meta = KNOWN_FUNDS[r.id];
    const id = meta.existingId || `fund-${meta.slug}`;
    const p = funds.find((f) => f.id === id);
    assert.ok(p, `صندوق ${id} در products.json نیست`);
    assert.equal(p.rate, Math.round(r.oneYear * 100) / 100, `نرخ ${id}`);
    assert.equal(p.subcategory, FIXED_INCOME_TYPES[r.typeId]);
    const isignal = p.extra?.isignalId ? p.extra : p.extra?.isignal;
    assert.equal(isignal?.isignalId, r.id, `فرادادهٔ آی‌سیگنال برای ${id}`);
  }
});

/* ---------- بهداشت نام صندوق‌ها ---------- */

test('tidyFundTitle تکرار عبارت «درآمد ثابت» را می‌زداید', () => {
  assert.equal(tidyFundTitle('صندوق درآمد ثابت ثابت آکام (ETF - آکام)'), 'صندوق درآمد ثابت آکام (ETF - آکام)');
  assert.equal(tidyFundTitle('صندوق درآمد ثابت با درآمد ثابت کمند (ETF - کمند)'), 'صندوق درآمد ثابت کمند (ETF - کمند)');
  assert.equal(tidyFundTitle('صندوق با درآمد ثابت امین آشنا ایرانیان (صدور و ابطالی)'), 'صندوق درآمد ثابت امین آشنا ایرانیان (صدور و ابطالی)');
  assert.equal(tidyFundTitle('صندوق درآمد ثابت کیان (ETF - کیان)'), 'صندوق درآمد ثابت کیان (ETF - کیان)', 'نام سالم دست‌نخورده می‌ماند');
});

test('نام‌های تمام صندوق‌های products.json بدون تکرار قالبی‌اند', () => {
  const funds = products.filter((p) => p.category === 'funds');
  for (const f of funds) {
    assert.ok(!/ثابت ثابت|درآمد ثابت با درآمد ثابت|صندوق با درآمد ثابت/.test(f.product), `نام مشکل‌دار: ${f.product}`);
  }
});

test('productTitle خروجی همیشه سر راست دارد', () => {
  const row = normalizeRow({ id: 553, name: 'با درآمد ثابت کیان', typeId: 43, manager: 'کارگزاری آگاه', oneYear: 30, date: '1405/07/05' });
  const title = productTitle(row, {});
  assert.ok(!/درآمد ثابت با درآمد ثابت|ثابت ثابت/.test(title), title);
});

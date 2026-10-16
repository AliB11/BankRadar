/**
 * آزمون منبع‌های واکشی و قرارداد «پاکت نتایج».
 *
 * چرا این آزمون‌ها حیاتی‌اند: خطای این لایه بی‌صداست. اگر شکل خروجی منبع با
 * آنچه ادغام‌کننده انتظار دارد نخواند، خط لوله «موفق» گزارش می‌کند و در عمل
 * هیچ داده‌ای به‌روز نمی‌شود. اینجا هر منبع روی سرور محلی واقعی اجرا می‌شود و
 * خروجی‌اش تا مرحله ادغام دنبال می‌شود.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { pool, unwrapPool, describeError } from '../tools/lib/http.mjs';
import { collect as collectBanks, extractBankSignals } from '../tools/sources/banks.mjs';
import { collectPages, mapToProduct } from '../tools/sources/rade.mjs';
import { mergeProducts } from '../tools/collect.mjs';

/** سرور آزمایشی محلی (بدون شبکه واقعی) */
async function withServer(handler, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    handler(req, res, hits);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, hits);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const BANK_PAGE = `<html><body>
  <h1>سپرده‌های بانکی</h1>
  <p>نرخ سود سپرده بلندمدت یک‌ساله معادل ۲۳ درصد است و حداقل موجودی ۱۰۰ میلیون تومان است.</p>
  <p>کارمزد سالانه حساب قرض‌الحسنه ۴ درصد تعیین شده است.</p>
</body></html>`;

const LOAN_PAGE = `<html><body>
  <h1>وام نقدی بانک نمونه</h1>
  <table class="specs">
    <tr><td>نام وام</td><td>وام نقدی نمونه</td></tr>
    <tr><td>بانک</td><td>بانک نمونه</td></tr>
    <tr><td>نوع وام</td><td>وام نقدی</td></tr>
    <tr><td>نرخ سود وام</td><td>۲۳ درصد</td></tr>
    <tr><td>کف وام</td><td>۵۰ میلیون تومان</td></tr>
    <tr><td>سقف وام</td><td>۳۰۰ میلیون تومان</td></tr>
    <tr><td>حداکثر زمان بازپرداخت</td><td>۶۰ ماه</td></tr>
    <tr><td>نوع ضمانت</td><td>ضامن معتبر</td></tr>
    <tr><td>نیاز به سپرده</td><td>خیر</td></tr>
    <tr><td>توضیحات</td><td>پرداخت پس از تکمیل پرونده<br>بدون مسدودی سپرده</td></tr>
  </table>
  <p>آخرین به‌روز رسانی: ۱۴۰۵/۰۶/۲۰</p>
</body></html>`;

/* ---------- ۱) قرارداد پاکت نتایج ---------- */

test('unwrapPool پاکت pool را باز می‌کند و زمینه کار شکست‌خورده را نگه می‌دارد', async () => {
  const contexts = [{ url: 'http://a' }, { url: 'http://b' }];
  const tasks = contexts.map((entry, i) => async () => {
    if (i === 0) throw new Error('شبکه در دسترس نبود');
    return { entry, ok: true, data: { product: `محصول ${i}` } };
  });

  const results = unwrapPool(await pool(tasks, 2), contexts, 'entry');

  assert.equal(results.length, 2);
  // کار شکست‌خورده: زمینه و پیام خطا باید با هم برگردند
  assert.equal(results[0].ok, false);
  assert.equal(results[0].entry.url, 'http://a', 'زمینه کار شکست‌خورده باید از روی اندیس برگردد');
  assert.match(results[0].error, /شبکه/);
  // کار موفق: خودِ مقدار برگردانده‌شده، نه پاکت
  assert.equal(results[1].ok, true);
  assert.deepEqual(results[1].data, { product: 'محصول 1' });
});

test('unwrapPool با ورودی ناقص هم نمی‌شکند', () => {
  assert.deepEqual(unwrapPool([], [], 'entry'), []);
  const out = unwrapPool([undefined, { ok: false, errorObject: new Error('timeout') }], [{ url: 'x' }, { url: 'y' }], 'entry');
  assert.equal(out[0].ok, false);
  assert.deepEqual(out[0].entry, { url: 'x' }, 'زمینه حتی برای پاکتِ تعریف‌نشده برمی‌گردد');
  assert.match(out[0].error, /نامشخص/);
  assert.equal(out[1].ok, false);
  assert.equal(out[1].entry.url, 'y');
  assert.match(out[1].error, /مهلت/, 'خطای خام باید به پیام خوانا ترجمه شود');
  assert.equal(describeError(new Error('fetch failed')), 'شبکه در دسترس نبود');
});

/* ---------- ۲) منبع سایت بانک‌ها ---------- */

test('منبع بانک‌ها هدف سالم و خراب را با هم گزارش می‌کند', async () => {
  await withServer((req, res) => {
    if (req.url === '/deposits') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(BANK_PAGE);
    } else {
      res.writeHead(404);
      res.end('یافت نشد');
    }
  }, async (base) => {
    const result = await collectBanks({
      concurrency: 2,
      targets: [
        { id: 'good-bank', label: 'بانک سالم', url: `${base}/deposits`, kind: 'bank', expect: [1, 35] },
        { id: 'gone-bank', label: 'بانک خراب', url: `${base}/gone`, kind: 'bank', expect: [1, 35] },
      ],
    });

    assert.equal(result.source, 'bank-sites');
    assert.equal(result.targets, 2, 'هر دو هدف باید گزارش شوند');
    assert.equal(result.observations.length, 2);
    assert.equal(result.ok, 1, 'فقط یک هدف موفق است');

    const good = result.observations.find((o) => o.id === 'good-bank');
    assert.equal(good.ok, true);
    assert.ok(good.rates.includes(23), `نرخ ۲۳ باید دیده شود: ${JSON.stringify(good.rates)}`);
    assert.ok(good.bytes > 100, 'حجم صفحه باید ثبت شود');
    assert.ok(Array.isArray(good.amounts));

    const bad = result.observations.find((o) => o.id === 'gone-bank');
    assert.equal(bad.ok, false);
    assert.equal(bad.url, `${base}/gone`);
    assert.ok(bad.error && bad.error.length > 0, 'خطا باید گزارش شود');
  });
});

test('سیگنال‌های صفحه بانک از متن استخراج می‌شود', () => {
  const signals = extractBankSignals(BANK_PAGE, [1, 35]);
  assert.ok(signals.rates.includes(23));
  assert.ok(signals.rates.includes(4), 'کارمزد ۴ درصد هم در متن است');
  assert.ok(signals.keywords.includes('قرض‌الحسنه'));
  assert.ok(signals.amounts.includes(100_000_000));
});

/* ---------- ۳) منبع رده ---------- */

test('collectPages رکورد واقعی برمی‌گرداند، نه پاکت نتیجه', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/loan/loan-cash-loan/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(LOAN_PAGE);
    } else {
      res.writeHead(404);
      res.end('یافت نشد');
    }
  }, async (base) => {
    const work = [
      { url: `${base}/loan/loan-cash-loan/1234-vam-naghdi`, lastmod: null },
      { url: `${base}/loan/loan-car-loan/9999-gone`, lastmod: null },
    ];

    const { products, failures } = await collectPages(work, { concurrency: 2 });

    assert.equal(products.length, 1, 'یک صفحه باید به محصول تبدیل شود');
    const p = products[0];

    // نشانه‌های «رکورد واقعی بودن» — اگر پاکت باز نشده بود، هیچ‌کدام نبودند
    assert.ok(p.product, 'فیلد product باید پر باشد؛ بدون آن ادغام رکورد را دور می‌اندازد');
    // شناسه از شماره انتهای نشانی ساخته می‌شود
    assert.equal(p.id, 'rade-1234');
    assert.equal(p.bank, 'بانک نمونه');
    assert.equal(p.rate, 23);
    assert.equal(p.rateKind, 'profit');
    assert.equal(p.category, 'loans');
    assert.equal(p.subcategory, 'cash');
    assert.equal(p.maxAmount, 300_000_000);
    assert.equal(p.minAmount, 50_000_000);
    assert.equal(p.termMonths, 60);
    assert.equal(p.collateralKind, 'guarantor');
    assert.equal(p.autoDiscovered, true);
    assert.equal(p.source.url, work[0].url);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].url, work[1].url, 'نشانی صفحه شکست‌خورده باید ثبت شود');
    assert.ok(failures[0].error.length > 0);
  });
});

test('خروجی منبع رده در ادغام، واقعاً ثبت می‌شود (نه دور ریخته)', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(LOAN_PAGE);
  }, async (base) => {
    const { products } = await collectPages([{ url: `${base}/loan/loan-cash-loan/555-plan`, lastmod: null }]);
    assert.equal(products.length, 1);

    // ادغام با مجموعه خالی: باید یک رکورد افزوده شود
    const first = mergeProducts([], products);
    assert.equal(first.stats.added, 1, 'رکورد تازه باید افزوده شود');
    assert.equal(first.merged.length, 1);
    assert.equal(first.merged[0].bank, 'بانک نمونه');

    // اجرای دوباره با نرخ عوض‌شده: باید به‌روزرسانی شود، نه تکرار
    const changedPage = LOAN_PAGE.replace('۲۳ درصد', '۲۴ درصد');
    await withServer((req2, res2) => {
      res2.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res2.end(changedPage);
    }, async (base2) => {
      const second = await collectPages([{ url: `${base2}/loan/loan-cash-loan/555-plan`, lastmod: null }]);
      // شناسه از نشانی ساخته می‌شود؛ برای تطبیق، همان رکورد قبلی را پایه می‌گیریم
      const incoming = second.products.map((p) => ({ ...p, id: first.merged[0].id }));
      const merged = mergeProducts(first.merged, incoming);
      assert.equal(merged.merged.length, 1, 'رکورد تکراری نباید ساخته شود');
      assert.equal(merged.merged[0].rate, 24, 'نرخ تازه باید جایگزین شود');
      assert.equal(merged.stats.updated, 1);
    });
  });
});

test('mapToProduct صفحه بدون جدول مشخصات را رد می‌کند', () => {
  assert.equal(mapToProduct('https://www.rade.ir/loan/loan-cash-loan/1', '<html><body>بدون جدول</body></html>'), null);
});

test('mapToProduct صفحات سپرده و خرید اقساطی رده را با bankId استخراج می‌کند', () => {
  const depositHtml = `
    <html><body>
      <table>
        <tr><td>نام حساب</td><td>طرح سرمایه‌گذاری بیست+ ویپاد بانک پاسارگاد</td></tr>
        <tr><td>نام بانک</td><td>بانک پاسارگاد</td></tr>
        <tr><td>سود</td><td>20 ٪</td></tr>
        <tr><td>حداقل موجودی</td><td>1 میلیون تومان</td></tr>
        <tr><td>مدت سپرده‌گذاری</td><td>1 ماه</td></tr>
        <tr><td>امکان گشایش غیرحضوری</td><td>دارد</td></tr>
        <tr><td>توضیحات</td><td>سود ۲۰٪ سالانه با سکه وی‌کلاب</td></tr>
      </table>
    </body></html>`;
  const dep = mapToProduct('https://www.rade.ir/bank-account-special-deposit/707740-bist-plus/', depositHtml);
  assert.ok(dep);
  assert.equal(dep.id, 'rade-707740');
  assert.equal(dep.category, 'deposits');
  assert.equal(dep.subcategory, 'premium');
  assert.equal(dep.bankId, 'pasargad');
  assert.equal(dep.rate, 20);
  assert.equal(dep.minAmount, 1_000_000);
  assert.equal(dep.digital, 85);

  const installmentHtml = `
    <html><body>
      <table>
        <tr><td>نام</td><td>کاریزماپی</td></tr>
        <tr><td>حداکثر اعتبار</td><td>20 میلیون تومان</td></tr>
        <tr><td>نرخ موثر</td><td>23 درصد</td></tr>
        <tr><td>حداکثر دوره بازپرداخت</td><td>6 ماه</td></tr>
        <tr><td>نوع ضمانت</td><td>بر اساس رتبه اعتباری</td></tr>
        <tr><td>توضیحات</td><td>وام نقدی نردبان اعتبار کاریزما</td></tr>
      </table>
    </body></html>`;
  const inst = mapToProduct('https://www.rade.ir/installment/708922-charismapay/', installmentHtml);
  assert.ok(inst);
  assert.equal(inst.id, 'rade-708922');
  assert.equal(inst.category, 'credit');
  assert.equal(inst.subcategory, 'bnpl');
  assert.equal(inst.bankId, 'charisma');
  assert.equal(inst.maxAmount, 20_000_000);
  assert.equal(inst.termMonths, 6);
});


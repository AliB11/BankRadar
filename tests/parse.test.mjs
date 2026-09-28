import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  stripTags,
  parseTomanAmount,
  parseRates,
  parseAllAmounts,
  toNumber,
  daysSince,
  slugify,
  foldForMatch,
  decodeEntities,
  faDisplayDigits,
  tidyPunct,
  sanitizeDisplayText,
  faDisplayText,
} from '../tools/lib/parse.mjs';

test('ارقام فارسی و عربی به لاتین تبدیل می‌شوند', () => {
  assert.equal(normalizeText('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  assert.equal(normalizeText('١٢٣'), '123');
  assert.equal(normalizeText('بانك ملي'), 'بانک ملی');
});

test('نیم‌فاصله در متن اصلی حفظ می‌شود', () => {
  // نیم‌فاصله معناساز است و نباید به فاصله تبدیل شود
  assert.equal(normalizeText('می‌خواهم'), 'می‌خواهم');
  assert.equal(normalizeText('وام به‌جا'), 'وام به‌جا');
  assert.equal(normalizeText('  الف   ب  '), 'الف ب');
});

test('foldForMatch نیم‌فاصله و علائم را برای تطبیق حذف می‌کند', () => {
  assert.equal(foldForMatch('می‌خواهم'), 'می خواهم');
  assert.equal(foldForMatch('وام به‌جا'), 'وام به جا');
  // «به‌جا» و «به جا» باید یکسان تطبیق داده شوند
  assert.equal(foldForMatch('وام به‌جا بلوبانک'), foldForMatch('وام به جا بلوبانک'));
  assert.equal(foldForMatch('سپرده (بلندمدت)'), 'سپرده بلندمدت');
});

test('مبالغ تومانی با واحد فارسی پارس می‌شوند', () => {
  assert.equal(parseTomanAmount('300 میلیون تومان'), 300_000_000);
  assert.equal(parseTomanAmount('۴۰۰ میلیون تومان'), 400_000_000);
  assert.equal(parseTomanAmount('۱.۵ میلیارد تومان'), 1_500_000_000);
  assert.equal(parseTomanAmount('225 هزار تومان'), 225_000);
  assert.equal(parseTomanAmount('3,000,000 تومان'), 3_000_000);
  assert.equal(parseTomanAmount('بدون سقف'), null);
});

test('نرخ‌های درصدی استخراج می‌شوند', () => {
  assert.deepEqual(parseRates('نرخ سود این وام 20 درصد و کارمزد آن 4 درصد است.'), [20, 4]);
  assert.deepEqual(parseRates('سود ۲۳٪'), [23]);
  assert.deepEqual(parseRates('بدون نرخ'), []);
  // مقادیر خارج از بازه ۰ تا ۱۰۰ نادیده گرفته می‌شوند
  assert.deepEqual(parseRates('سال 1405 و نرخ 23 درصد'), [23]);
});

test('همه مبالغ یک متن استخراج می‌شوند', () => {
  const amounts = parseAllAmounts('کف 3 میلیون و سقف 400 میلیون تومان');
  assert.ok(amounts.includes(3_000_000));
  assert.ok(amounts.includes(400_000_000));
});

test('حذف تگ‌های HTML', () => {
  assert.equal(stripTags('<p>سلام <b>دنیا</b></p>'), 'سلام دنیا');
  assert.equal(stripTags('<script>alert(1)</script>متن'), 'متن');
});

test('تبدیل اعداد اعشاری', () => {
  assert.equal(toNumber('۶۹.۹'), 69.9);
  assert.equal(toNumber('24/5'), 24.5);
  assert.equal(toNumber('نامعتبر'), null);
});

test('محاسبه فاصله روزها', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  assert.equal(daysSince('2026-09-15', now), 0);
  assert.equal(daysSince('2026-09-01', now), 14);
  assert.equal(daysSince('2026-01-01', now), 257);
  assert.equal(daysSince('نامعتبر', now), Infinity);
});

test('شناسه‌سازی نام بانک‌ها', () => {
  assert.equal(slugify('بانک ملت'), 'mellat');
  assert.equal(slugify('بلوبانک'), 'blubank');
  assert.equal(slugify('بانک ناشناخته نمونه'), 'بانک-ناشناخته-نمونه');
});

/* ---------- سقف نسبی نباید مبلغ شمرده شود ----------
 *
 * بعضی بانک‌ها سقف وام را کسر از قیمت کالا تعریف می‌کنند: «معادل ۵۰ درصد
 * قیمت خودرو». اگر عدد ۵۰ را مبلغ فرض کنیم، سقفی هزار مرتبه کوچک‌تر از
 * واقعیت می‌سازیم و رابط دچار تناقض می‌شود (حداقل مبلغ از سقف بیشتر
 * درمی‌آید). این آزمون جلوی بازگشت آن اشکال را می‌گیرد.
 */

test('درصد به‌عنوان سقف، مبلغ شمرده نمی‌شود', () => {
  assert.equal(parseTomanAmount('50 ٪'), null, '«۵۰٪» مبلغ نیست');
  assert.equal(parseTomanAmount('50%'), null);
  assert.equal(parseTomanAmount('۵۰ درصد قیمت خودرو'), null, 'ارقام فارسی هم باید پوشش داده شود');
  assert.equal(parseTomanAmount('تا 100 درصد'), null);
  assert.equal(parseTomanAmount('معادل 50 درصد ارزش ملک'), null);
});

test('مبالغ واقعی همچنان درست خوانده می‌شوند', () => {
  assert.equal(parseTomanAmount('100 میلیون تومان'), 100_000_000);
  assert.equal(parseTomanAmount('۱ میلیارد تومان'), 1_000_000_000);
  assert.equal(parseTomanAmount('500,000,000 ریال'), 500_000_000);
  assert.equal(parseTomanAmount('50 میلیون تومان'), 50_000_000, 'عدد ۵۰ با واحد مبلغ باید بماند');
  assert.equal(parseTomanAmount('نامشخص'), null);
  assert.equal(parseTomanAmount(''), null);
});

/* ---------- بهداشت متن نمایشی (موجودیت HTML، ارقام، نشانه‌گذاری) ---------- */

test('decodeEntities موجودیت‌های نامی و عددی را رمزگشایی می‌کند', () => {
  assert.equal(decodeEntities('&#8211;'), '–');
  assert.equal(decodeEntities('&ndash;'), '–');
  assert.equal(decodeEntities('&zwnj;'), '\u200c');
  assert.equal(decodeEntities('الف&nbsp;ب'), 'الف\u00a0ب');
  assert.equal(decodeEntities('&amp;ر'), '&ر');
  // نویسه‌های خارج از بازه دست‌نخورده می‌مانند
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
  assert.equal(decodeEntities('&unknownent;'), '&unknownent;');
});

test('decodeEntities موجودیت‌های خراب با ارقام فارسی را هم می‌شناسد', () => {
  // میراث خطای پیشین: faDigits روی متن با موجودیت، «&#8211;» را «&#۸۲۱۱;» می‌کرد
  assert.equal(decodeEntities('مدت &#۸۲۱۱;'), 'مدت –');
  assert.equal(decodeEntities('&#۹۷;'), 'a');
});

test('faDisplayDigits ارقام را برای نمایش فارسی می‌کند', () => {
  assert.equal(faDisplayDigits('100 میلیارد تومان'), '۱۰۰ میلیارد تومان');
  assert.equal(faDisplayDigits('نرخ 22.5٪'), 'نرخ ۲۲.۵٪');
  assert.equal(faDisplayDigits('ETF'), 'ETF');
});

test('tidyPunct نشانه‌گذاری را نظم می‌دهد بدون شکستن دامنه و اعشار', () => {
  assert.equal(tidyPunct('سود ندارد.. نرخ‌ها طبق جدول'), 'سود ندارد. نرخ‌ها طبق جدول');
  assert.equal(tidyPunct('حداقل مبلغ:  ۱۰۰ هزار'), 'حداقل مبلغ: ۱۰۰ هزار');
  assert.equal(tidyPunct('سود ۲۲.۵٪'), 'سود ۲۲.۵٪', 'اعشار فارسی نباید فاصله بگیرد');
  assert.equal(tidyPunct('سایت (sobatfund.navidfg.com) رسمی است'), 'سایت (sobatfund.navidfg.com) رسمی است');
  assert.equal(tidyPunct('بر پایه https://example.com/x آمده.'), 'بر پایه https://example.com/x آمده.');
});

test('sanitizeDisplayText موجودیت خام منابع را پاک می‌کند', () => {
  assert.equal(sanitizeDisplayText('مزایا: &#8211;'), 'مزایا: –');
  assert.equal(sanitizeDisplayText('وام&nbsp;به‌جا'), 'وام به‌جا');
});

test('faDisplayText متن نمایشی نهایی یکدست می‌سازد', () => {
  assert.equal(faDisplayText('100 میلیارد تومان سقف وام است.'), '۱۰۰ میلیارد تومان سقف وام است.');
});

test('stripTags موجودیت‌های HTML را نیز رمزگشایی می‌کند', () => {
  assert.equal(stripTags('<td>الف&zwnj;ب&#8211;ج</td>'), 'الف\u200cب–ج');
});

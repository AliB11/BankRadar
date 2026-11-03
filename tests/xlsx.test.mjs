/**
 * آزمون تولیدکنندهٔ اکسل (xlsx.js).
 *
 * چرا حیاتی است: خروجی خراب در مرورگر «فایل دانلود شد» می‌گوید و کاربر فقط
 * بعد از باز کردن فایل در اکسل می‌فهمد خراب است. اینجا ساختار ZIP بایت‌به‌بایت
 * خوانده می‌شود، CRC هر ورودی راستی‌آزمایی می‌شود و XML برگه‌ها بررسی می‌شود.
 * هیچ وابستگی خارجی لازم نیست؛ تمام بررسی‌ها با Node خالص انجام می‌شود.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildXlsx, crc32, columnLetter, xmlEscape, safeSheetName, zipStore } from '../assets/js/xlsx.js';

const textEncoder = new TextEncoder();

/* ---------- ابزار خواندن ZIP (برای آزمون، بدون وابستگی) ---------- */

/** EOCD را پیدا و فهرست مرکزی را تجزیه می‌کند؛ نام‌ها همه ASCII اند. */
function readZipEntries(bytes) {
  // جست‌وجوی امضای EOCD از انتها (کامنت نداریم)
  let eocdAt = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdAt = i;
      break;
    }
  }
  assert.ok(eocdAt >= 0, 'EOCD یافت نشد');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(eocdAt + 10, true);
  const cdOffset = dv.getUint32(eocdAt + 16, true);
  const entries = [];
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(dv.getUint32(at, true), 0x02014b50, 'امضای ورودی مرکزی نامعتبر است');
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const localOffset = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // خواندن داده از Local Header: نام در آفست ۳۰ است
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const extraLen = dv.getUint16(localOffset + 28, true);
    const dataAt = localOffset + 30 + localNameLen + extraLen;
    const data = bytes.subarray(dataAt, dataAt + size);
    entries.push({ name, crc, size, data });
    at += 46 + nameLen;
  }
  return entries;
}

/* ---------- واحد ---------- */

test('CRC32 با بردار شناخته‌شده هم‌خوان است', () => {
  // بردار کلاسیک: CRC32 رشتهٔ "123456789" برابر 0xCBF43926 است
  assert.equal(crc32(textEncoder.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('شماره ستون اکسل درست ساخته می‌شود', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(28), 'AC');
});

test('فرار XML همه نویسه‌های خاص را می‌پوشاند و نویسه کنترلی را حذف می‌کند', () => {
  assert.equal(xmlEscape('a<b>&"c\'d'), 'a&lt;b&gt;&amp;&quot;c&apos;d');
  assert.equal(xmlEscape('سود ۲۳٪'), 'سود ۲۳٪');
  assert.equal(xmlEscape('با\u0007نویسه'), 'بانویسه');
});

test('نام برگه ممنوعه‌ها را پاک و به ۳۱ نویسه محدود می‌کند', () => {
  assert.equal(safeSheetName('محصولات: مقایسه', 0), 'محصولات مقایسه');
  assert.equal(safeSheetName('x'.repeat(40), 0), 'x'.repeat(31));
  assert.equal(safeSheetName('', 2), 'Sheet3');
});

/* ---------- ساختار ZIP ---------- */

test('خروجی xlsx یک ZIP معتبر با ورودی‌های الزامی است', () => {
  const bytes = buildXlsx([
    { name: 'محصولات', columns: ['بانک', 'نرخ'], rows: [['بانک نمونه', 23]] },
  ]);
  assert.ok(bytes.length > 200, 'خروجی بیش‌ازحد کوچک است');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b, 'امضای ZIP (PK) یافت نشد');

  const entries = readZipEntries(bytes);
  const names = entries.map((e) => e.name);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(names.includes(required), `ورودی ${required} در ZIP نیست`);
  }
  // CRC هر ورودی باید با محتوای واقعی بخواند
  for (const entry of entries) {
    assert.equal(crc32(entry.data), entry.crc, `CRC ورودی ${entry.name} ناهم‌خوان است`);
    assert.equal(entry.size, entry.data.length, 'اندازهٔ ثبت‌شده با داده نمی‌خواند');
  }
});

test('چند برگه به چند worksheet و رابط تبدیل می‌شود', () => {
  const bytes = buildXlsx([
    { name: 'اول', columns: ['الف'], rows: [[1]] },
    { name: 'دوم', columns: ['ب'], rows: [[2]] },
    { name: 'سوم', columns: ['پ'], rows: [[3]] },
  ]);
  const entries = readZipEntries(bytes);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('xl/worksheets/sheet3.xml'), 'برگهٔ سوم ساخته نشد');
  const workbook = entries.find((e) => e.name === 'xl/workbook.xml').data;
  const wbText = new TextDecoder().decode(workbook);
  assert.ok(wbText.includes('rId2'), 'رابط برگهٔ دوم در workbook نیست');
  const rels = new TextDecoder().decode(entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels').data);
  assert.match(rels, /Target="worksheets\/sheet3\.xml"/);
});

/* ---------- محتوای برگه ---------- */

function sheet1Text(bytes) {
  const entries = readZipEntries(bytes);
  return new TextDecoder().decode(entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').data);
}

test('برگه راست‌به‌چپ است، سربرگ منجمد دارد و متن فارسی سالم می‌ماند', () => {
  const bytes = buildXlsx([
    {
      name: 'محصولات',
      columns: ['بانک', 'محصول'],
      rows: [['بانک رفاه کارگران', 'وام ازدواج — ۳ سال']],
      widths: [24, 30],
    },
  ]);
  const xml = sheet1Text(bytes);
  assert.match(xml, /rightToLeft="1"/, 'برگه باید راست‌به‌چپ باشد');
  assert.match(xml, /<pane ySplit="1"/, 'سربرگ باید منجمد شود');
  assert.match(xml, /state="frozen"/);
  assert.match(xml, /بانک رفاه کارگران/, 'متن فارسی باید سالم در XML بماند');
  assert.match(xml, /<col min="1" max="1" width="24"/, 'عرض ستون اعمال نشد');
  // سربرگ با سبک ۱ (بولد/پُر) نشانه‌گذاری شده
  assert.match(xml, /t="inlineStr" s="1"/);
});

test('اعداد سلول عددی می‌شوند تا در اکسل قابل فرمول باشند', () => {
  const xml = sheet1Text(buildXlsx([{ name: 'x', columns: ['نرخ'], rows: [[23.5], ['—'], [null]] }]));
  assert.match(xml, /<c r="A2"><v>23\.5<\/v><\/c>/, 'عدد باید سلول عددی شود');
  // سلول تهی حذف می‌شود؛ متن در سطر بعد درون‌خطی است
  assert.match(xml, /t="inlineStr"/);
  assert.ok(!xml.includes('<v>null'), 'مقدار null نباید در خروجی بیاید');
});

test('ارقام و متن با نویسه‌های XML خراب نمی‌شوند و درون‌خطی حفظ می‌شوند', () => {
  const xml = sheet1Text(
    buildXlsx([{ name: 'x', columns: ['A<B'], rows: [['متن & آزمون']] }]),
  );
  assert.match(xml, /A&lt;B/);
  assert.match(xml, /متن &amp; آزمون/);
});

test('بدون برگه معتبر، شکست صریح بهتر از فایل تهی است', () => {
  assert.throws(() => buildXlsx([]), /هیچ برگه‌ای/);
  assert.throws(() => buildXlsx([{ name: 'x', columns: [], rows: [] }]), /هیچ برگه‌ای/);
});

test('zipStore دادهٔ خام را هم می‌پذیرد', () => {
  const bytes = zipStore([{ name: 'hello.txt', data: textEncoder.encode('سلام') }]);
  const entries = readZipEntries(bytes);
  assert.equal(entries.length, 1);
  assert.equal(new TextDecoder().decode(entries[0].data), 'سلام');
});

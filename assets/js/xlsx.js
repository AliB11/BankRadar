/**
 * تولیدکنندهٔ فایل اکسل (.xlsx) بدون هیچ وابستگی خارجی.
 *
 * چرا دستی و نه کتابخانه؟ فلسفهٔ این مخزن «صفر وابستگی» است: سبک‌سازی کامل،
 * بدون build و بدون CDN. قالب xlsx فقط یک ZIP از فایل‌های XML است؛ ذخیرهٔ
 * بدون فشرده‌سازی (STORE) پیاده‌سازی ZIP را به چند ده خط ساده می‌رساند و
 * حجم خروجی برای جدول‌های این سامانه (چندصد ردیف) کاملاً قابل قبول است.
 *
 * محدودیت‌های عمدی:
 *   - بدون فرمول، نمودار و استایل پیچیده؛ فقط جدول داده با سربرگ بولد و
 *     عرض ستون. خوانایی و قابل مرتب‌سازی بودن ملاک است، نه گزارش زیباسازی‌شده.
 *   - اعداد به‌صورت سلول عددی ذخیره می‌شوند تا در اکسل قابل فرمول‌نویسی باشند.
 *   - هر برگه راست‌به‌چپ (rightToLeft) و سطر سربرگش منجمد است.
 *
 * این ماژول DOM ندارد تا در آزمون‌های Node هم قابل استفاده باشد.
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/* ---------- ابزار بایت ---------- */

const textEncoder = new TextEncoder();

/** جدول CRC32 — یک‌بار ساخته می‌شود و برای همهٔ ورودی‌ها استفاده می‌شود. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 استاندارد ZIP روی بایت‌ها. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * مونتاژ ZIP با روش STORE (بدون فشرده‌سازی).
 * @param {Array<{name:string, data:Uint8Array|string}>} entries
 * @returns {Uint8Array}
 */
export function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => v & 0xffff;
  const u32 = (v) => v >>> 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? textEncoder.encode(entry.data) : entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // امضای Local File Header
    lv.setUint16(4, 20, true); // نسخهٔ لازم
    lv.setUint16(6, 0, true); // بدون پرچم
    lv.setUint16(8, 0, true); // روش STORE
    lv.setUint16(10, 0, true); // زمان DOS (ثابت)
    lv.setUint16(12, 0x21, true); // تاریخ DOS (۱۹۸۰/۰۱/۰۱)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // امضای Central Directory
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // مکان Local Header
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // امضای End of Central Directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of [...parts, ...central, eocd]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/* ---------- ابزار XML ---------- */

/** فرار دادن متن برای XML — پنج نویسهٔ خاص + حذف نویسه‌های کنترلی غیرمجاز. */
export function xmlEscape(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** شمارهٔ ستون صفرمبنا به نشانی اکسل: 0→A، 25→Z، 26→AA. */
export function columnLetter(index) {
  let n = Math.floor(index) + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** نام برگهٔ سالم: حداکثر ۳۱ نویسه، بدون نویسه‌های ممنوع اکسل و با فاصله‌های فشرده. */
export function safeSheetName(name, index) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

/* ---------- مونتاژ برگه ---------- */

/**
 * یک سلول خروجی می‌دهد؛ عدد → سلول عددی، بقیه → متن درون‌خطی.
 * rowNumber مطلق و یک‌مبناست (سطر ۱ سربرگ). سلول تهی برای XML کوچک‌تر حذف
 * می‌شود (نشانی صریح هر سلول حفظ است).
 */
function cellXML(colIndex, rowNumber, value) {
  const ref = `${columnLetter(colIndex)}${rowNumber}`;
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = xmlEscape(value);
  const space = /^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

/**
 * XML یک برگه: سربرگ منجمد، راست‌به‌چپ، عرض ستون و سبک سربرگ (s="1").
 * @param {{name:string, columns:string[], rows:Array<Array<any>>, widths?:number[]}} sheet
 */
function sheetXML(sheet) {
  const widths = sheet.widths ?? sheet.columns.map(() => 14);
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.min(80, w))}" customWidth="1"/>`)
    .join('');
  const header = `<row r="1">${sheet.columns
    .map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="1"><is><t>${xmlEscape(c)}</t></is></c>`)
    .join('')}</row>`;

  const body = sheet.rows
    .map((row, r) => {
      const rn = r + 2; // سطر ۱ سربرگ است
      const cells = row.map((v, c) => cellXML(c, rn, v)).join('');
      return cells ? `<row r="${rn}">${cells}</row>` : '';
    })
    .join('');
  const lastCol = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = sheet.rows.length + 1;
  return `${XML_DECL}
<worksheet xmlns="${MAIN_NS}">
  <sheetViews>
    <sheetView rightToLeft="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="16"/>
  <cols>${cols}</cols>
  <sheetData>${header}${body}</sheetData>
  <dimension ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

/**
 * ساخت فایل xlsx کامل از چند برگه.
 *
 * @param {Array<{name:string, columns:string[], rows:Array<Array<any>>, widths?:number[]}>} sheets
 * @returns {Uint8Array} بایت‌های فایل
 */
export function buildXlsx(sheets) {
  const list = (sheets ?? []).filter((s) => s && Array.isArray(s.columns) && s.columns.length);
  if (!list.length) throw new Error('هیچ برگه‌ای با ستون برای خروجی اکسل تعریف نشده است');

  const entries = [];
  const overrides = [];
  const sheetTags = [];
  const sheetRels = [];

  // روابط: برگه‌ها rId1..N و استایل آخرین rId
  list.forEach((sheet, i) => {
    const name = safeSheetName(sheet.name, i);
    const part = `/xl/worksheets/sheet${i + 1}.xml`;
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML({ ...sheet, name }) });
    overrides.push(
      `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    sheetTags.push(`<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    sheetRels.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    );
  });
  const styleRelId = list.length + 1;
  sheetRels.push(
    `<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  );

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides.join('\n  ')}
</Types>`,
  });

  entries.push({
    name: '_rels/.rels',
    data: `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  entries.push({
    name: 'xl/workbook.xml',
    data: `${XML_DECL}
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <bookViews><workbookView/></bookViews>
  <sheets>${sheetTags.join('')}</sheets>
</workbook>`,
  });

  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `${XML_DECL}
<Relationships xmlns="${PKG_REL_NS}">
  ${sheetRels.join('\n  ')}
</Relationships>`,
  });

  entries.push({
    name: 'xl/styles.xml',
    data: `${XML_DECL}
<styleSheet xmlns="${MAIN_NS}">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9F1EC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  });

  return zipStore(entries);
}

/**
 * آزمون نگهبان چیدمان (CSS).
 *
 * چرا این آزمون لازم است: سامانه راست‌به‌چپ است، ولی properties فیزیکی مثل
 * translateX با جهت سند عوض نمی‌شوند. یک خطای ساده در علامتِ جابه‌جایی باعث
 * شد کشوی بسته به‌جای رفتن به بیرونِ صفحه، به وسط صفحه بیاید و یک قاب
 * تمام‌قد روی کل محتوا بنشیند. این آزمون همان هندسه را روی فایل CSS بازسازی
 * می‌کند و علاوه بر آن، همه لایه‌های ثابتِ تمام‌صفحه را بررسی می‌کند تا هیچ‌کدام
 * در حالت پیش‌فرض دیده نشوند یا کلیک کاربر را نگیرند.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const css = read('assets/css/app.css');
const html = read('index.html');

/* ---------- تجزیه ساده CSS ---------- */

/**
 * بیرون کشیدن همه بلوک‌های «سلکتور { اعلام‌ها }» از متن CSS.
 * بلوک‌های تودرتو (@media) باز می‌شوند تا قواعد درونشان هم دیده شوند.
 * @returns {{selector:string, decls:Record<string,string>, media:string}[]}
 */
function parseRules(source) {
  // حذف توضیحات تا سلکتورهای درون کامنت اشتباه گرفته نشوند
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let media = '';
  let i = 0;
  let buffer = '';

  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buffer.trim();
      buffer = '';
      // پیدا کردن جفتِ این آکولاد با شمارش تودرتویی
      let depth = 1;
      let j = i + 1;
      let body = '';
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth += 1;
        else if (clean[j] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        body += clean[j];
        j += 1;
      }

      if (head.startsWith('@media')) {
        const prev = media;
        media = head;
        rules.push(...parseRules(body).map((r) => ({ ...r, media: `${media} ${r.media}`.trim() })));
        media = prev;
      } else if (head.startsWith('@')) {
        // سایر قواعد at-rule (keyframes و مانند آن) — در این آزمون کاری با آن‌ها نیست
      } else {
        const decls = {};
        for (const part of body.split(';')) {
          const idx = part.indexOf(':');
          if (idx < 0) continue;
          const key = part.slice(0, idx).trim();
          const value = part.slice(idx + 1).trim();
          if (key) decls[key] = value;
        }
        rules.push({ selector: head, decls, media });
      }
      i = j + 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  return rules;
}

const rules = parseRules(css);
const findRule = (selector) => rules.find((r) => r.selector.replace(/\s+/g, ' ') === selector);

/** خواندن یک اعلام از چند سلکتور، با اولویت سلکتور دقیق‌تر (دیرتر در فایل) */
function declFor(selectors, prop) {
  let value;
  for (const s of selectors) {
    for (const r of rules.filter((x) => x.selector.includes(s))) {
      if (r.decls[prop] !== undefined) value = r.decls[prop];
    }
  }
  return value;
}

/* ---------- ۱) جهت سند ---------- */

test('سند راست‌به‌چپ و فارسی است', () => {
  assert.match(html, /<html[^>]*lang="fa"/, 'lang باید fa باشد');
  assert.match(html, /<html[^>]*dir="rtl"/, 'dir باید rtl باشد');
});

test('جست‌وجوی مستقیم، combobox دسترس‌پذیر و فهرست پیشنهاد دارای استایل دارد', () => {
  assert.match(html, /id="global-search"[^>]*role="combobox"/s);
  assert.match(html, /aria-controls="search-suggestions"/);
  assert.match(html, /id="search-suggestions"[^>]*role="listbox"/);
  assert.ok(findRule('.search-suggestions'), 'فهرست پیشنهادها باید استایل مستقل داشته باشد');
  assert.ok(rules.some((rule) => rule.selector.includes('.search-suggestion[aria-selected="true"]')), 'گزینه فعال باید حالت قابل‌مشاهده داشته باشد');
});

/* ---------- ۲) هندسه کشو در حالت بسته ---------- */

/**
 * بازسازی هندسه جعبه کشو.
 * inset-inline-start در RTL یعنی لبه راست، و translateX همیشه فیزیکی است
 * (درصد منفی = جابه‌جایی به چپ).
 */
function drawerBox({ viewport, drawerWidth, dir, translatePercent }) {
  const w = Math.min(drawerWidth, viewport);
  const start = dir === 'rtl' ? viewport - w : 0;
  const shift = (translatePercent / 100) * w;
  return { left: start + shift, right: start + w + shift, width: w };
}

const translateValue = (raw) => {
  assert.ok(raw, 'transform حالت بسته کشو تعریف نشده است');
  const m = String(raw).match(/translateX\(\s*(-?\d+(?:\.\d+)?)%\s*\)/);
  assert.ok(m, `transform کشو باید translateX درصدی باشد، ولی «${raw}» است`);
  return Number(m[1]);
};

test('کشوی بسته در RTL کاملاً بیرون از صفحه است', () => {
  const rtlPercent = translateValue(declFor(["[dir='rtl'] .drawer"], 'transform'));

  for (const viewport of [360, 390, 768, 1280, 1440, 1920]) {
    const box = drawerBox({ viewport, drawerWidth: 560, dir: 'rtl', translatePercent: rtlPercent });
    const onScreen = box.right > 0 && box.left < viewport;
    assert.equal(
      onScreen,
      false,
      `در عرض ${viewport}px کشوی بسته روی صفحه می‌نشیند (left=${Math.round(box.left)}, right=${Math.round(box.right)})`,
    );
  }
});

test('کشوی بسته در LTR هم بیرون از صفحه می‌ماند', () => {
  // مقدار پایه (بدون [dir=rtl]) برای LTR به‌کار می‌رود
  const base = findRule('.drawer');
  assert.ok(base, 'قاعده .drawer پیدا نشد');
  const ltrPercent = translateValue(base.decls.transform);

  for (const viewport of [360, 768, 1440]) {
    const box = drawerBox({ viewport, drawerWidth: 560, dir: 'ltr', translatePercent: ltrPercent });
    assert.equal(box.right > 0 && box.left < viewport, false, `در LTR و عرض ${viewport}px کشو دیده می‌شود`);
  }
});

test('کشوی باز روی صفحه و هم‌تراز لبه شروع است', () => {
  const open = findRule('.drawer.is-open');
  assert.ok(open, 'قاعده .drawer.is-open پیدا نشد');
  assert.match(open.decls.transform ?? '', /translateX\(0\)/, 'حالت باز باید translateX(0) باشد');
  assert.equal(open.decls.visibility, 'visible', 'کشوی باز باید visibility: visible داشته باشد');
  assert.equal(open.decls['pointer-events'], 'auto', 'کشوی باز باید تعامل‌پذیر باشد');
});

test('کشوی بسته دیده نمی‌شود و کلیک نمی‌گیرد', () => {
  const base = findRule('.drawer');
  assert.ok(base, 'قاعده .drawer پیدا نشد');
  assert.equal(base.decls.visibility, 'hidden', 'حالت بسته باید visibility: hidden باشد');
  assert.equal(base.decls['pointer-events'], 'none', 'حالت بسته باید pointer-events: none باشد');
  assert.equal(base.decls.position, 'fixed');
  assert.ok(base.decls.transition?.includes('visibility'), 'visibility باید در transition باشد تا انیمیشن خروج قطع نشود');
});

/* ---------- ۳) هیچ لایه ثابت تمام‌صفحه‌ای در حالت پیش‌فرض دیده نمی‌شود ---------- */

/** آیا این قاعده تمام صفحه را می‌پوشاند؟ */
function coversViewport(decls) {
  if (decls.position !== 'fixed') return false;
  const both = (a, b) => decls[a] === '0' || decls[b] === '0';
  const vertical = decls.inset === '0' || decls['inset-block'] === '0' || both('top', 'bottom');
  const horizontal =
    decls.inset === '0' ||
    decls['inset-inline-start'] === '0' ||
    decls['inset-inline-end'] === '0' ||
    decls.left === '0' ||
    decls.right === '0';
  return vertical && horizontal;
}

/** آیا در حالت پیش‌فرض پنهان است (دیده نمی‌شود یا پشت محتواست)؟ */
function hiddenByDefault(decls) {
  if (decls.display === 'none') return true;
  if (decls.visibility === 'hidden') return true;
  if (Number(decls.opacity) === 0) return true;
  if (decls['z-index'] !== undefined && Number(decls['z-index']) < 0) return true; // لایه پس‌زمینه
  const m = (decls.transform ?? '').match(/translate[XY]\(\s*(-?\d+(?:\.\d+)?)%\s*\)/);
  if (m && Math.abs(Number(m[1])) >= 100) return true; // بیرون از صفحه
  return false;
}

test('همه لایه‌های ثابتِ تمام‌صفحه در حالت پیش‌فرض پنهان‌اند', () => {
  const offenders = [];
  for (const r of rules) {
    if (r.media) continue; // قواعد واکنش‌گرا فقط اندازه را تغییر می‌دهند
    if (!coversViewport(r.decls)) continue;
    if (!hiddenByDefault(r.decls)) offenders.push(r.selector);
  }
  assert.deepEqual(offenders, [], `این لایه‌ها در حالت پیش‌فرض روی صفحه دیده می‌شوند: ${offenders.join(', ')}`);
});

test('لایه‌های تمام‌صفحه با z-index مثبت، در حالت بسته کلیک کاربر را نمی‌گیرند', () => {
  const offenders = [];
  for (const r of rules) {
    if (r.media) continue;
    if (!coversViewport(r.decls)) continue;
    const z = Number(r.decls['z-index'] ?? 0);
    if (z <= 0) continue; // لایه‌های پس‌زمینه زیر محتوا هستند
    if (r.decls['pointer-events'] !== 'none') offenders.push(`${r.selector} (z-index:${z})`);
  }
  assert.deepEqual(offenders, [], `این لایه‌ها می‌توانند کلیک را ببلعند: ${offenders.join(', ')}`);
});

test('پس‌زمینه‌های ثابت تزئینی کلیک را مسدود نمی‌کنند', () => {
  for (const selector of ['body::before', 'body::after']) {
    const r = findRule(selector);
    assert.ok(r, `قاعده ${selector} پیدا نشد`);
    assert.equal(r.decls['pointer-events'], 'none', `${selector} باید pointer-events: none داشته باشد`);
    assert.ok(Number(r.decls['z-index']) < 0, `${selector} باید زیر محتوا باشد`);
  }
});

/* ---------- ۴) هم‌خوانی پوسته و CSS ---------- */

test('هر شناسه لایه‌ای که app.js می‌گیرد در index.html وجود دارد', () => {
  const appSrc = read('assets/js/app.js');
  const used = new Set([...appSrc.matchAll(/\$\('#([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(used.size >= 5, 'انتظار چند شناسه پرکاربرد را داشتیم');
  const missing = [...used].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `شناسه‌های ناموجود در index.html: ${missing.join(', ')}`);
});

test('کلاس‌های لایه‌ای پوسته هم در HTML و هم در CSS تعریف شده‌اند', () => {
  for (const cls of ['drawer', 'drawer-backdrop', 'modal-backdrop', 'toast-stack', 'skip-link']) {
    assert.ok(html.includes(cls), `کلاس ${cls} در index.html نیست`);
    assert.ok(css.includes(`.${cls}`), `کلاس ${cls} در app.css تعریف نشده است`);
  }
});

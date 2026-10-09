/**
 * آزمون یکپارچگی راه‌انداز سامانه.
 *
 * دو محافظ اصلی:
 *  ۱) قرارداد رویدادها — هر data-action که views.js تولید می‌کند باید در app.js
 *     مدیریت شده باشد؛ در غیر این صورت دکمه‌ای در سامانه بی‌اثر می‌ماند.
 *  ۲) راه‌اندازی واقعی — app.js روی یک DOM شبیه‌سازی‌شده اجرا می‌شود تا خطاهای
 *     زمان اجرا و شناسه‌های ناموجود پیش از انتشار گرفته شوند.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- ۱) قرارداد رویدادها (تحلیل ایستا) ---------- */

test('هر data-action تولیدشده در views.js در app.js مدیریت می‌شود', () => {
  const viewsSrc = read('assets/js/views.js');
  const appSrc = read('assets/js/app.js');

  const emitted = new Set(
    [...viewsSrc.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]),
  );
  const handled = new Set(
    [...appSrc.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]),
  );

  assert.ok(emitted.size >= 15, `تعداد اکشن‌ها کمتر از انتظار: ${emitted.size}`);

  const missing = [...emitted].filter((a) => !handled.has(a));
  assert.deepEqual(missing, [], `اکشن‌های بی‌مدیریت: ${missing.join(', ')}`);
});

test('هر data-filter تولیدشده با فیلترهای store هم‌خوان است', () => {
  const viewsSrc = read('assets/js/views.js');
  const storeSrc = read('assets/js/store.js');

  const emitted = new Set(
    [...viewsSrc.matchAll(/data-filter="([a-zA-Z]+)"/g)].map((m) => m[1]),
  );
  assert.ok(emitted.size >= 8, `تعداد فیلترها کمتر از انتظار: ${emitted.size}`);

  // فیلترها باید در شیء پیش‌فرض store.filters وجود داشته باشند
  const defaults = storeSrc.match(/filters:\s*\{([^}]*)\}/s)?.[1] ?? '';
  for (const key of emitted) {
    assert.ok(
      new RegExp(`\\b${key}\\s*:`).test(defaults),
      `فیلتر «${key}» در store.filters تعریف نشده است`,
    );
  }
});

test('نام همه کنش‌های data-action با خط تیره و بدون حرف بزرگ است', () => {
  const viewsSrc = read('assets/js/views.js');
  for (const m of viewsSrc.matchAll(/data-action="([^"]+)"/g)) {
    assert.ok(/^[a-z]+(-[a-z]+)*$/.test(m[1]), `نام کنش نامعتبر: ${m[1]}`);
  }
});

/* ---------- ۲) راه‌اندازی واقعی روی DOM شبیه‌سازی‌شده ---------- */

test('راه‌انداز سامانه روی پوسته واقعی بدون خطا اجرا می‌شود', async () => {
  const shim = await import('./domshim.mjs');
  const { doc, Element, installDOM, makeEvent } = shim;
  const timers = installDOM();

  const memory = new Map();
  memory.set('bankradar.v2.filters', JSON.stringify({ query: 'بلو', category: 'deposits' }));
  globalThis.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };

  // داده درون‌خطی
  const bundleSource = read('data/bundle.js');
  const sandbox = {};
  new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
  globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;

  // پوسته: همان شناسه‌هایی که index.html دارد
  const shellIds = [
    'hero', 'tabs', 'filters', 'toolbar', 'cards', 'rank', 'compare', 'charts',
    'footer', 'loading', 'result-count', 'nav-compare-count', 'boot-status',
    'global-search', 'search-suggestions', 'drawer', 'drawer-backdrop', 'data-modal', 'method-modal', 'toast-stack',
  ];
  doc.body.innerHTML = '';
  for (const id of shellIds) {
    const el = new Element(id);
    el.id = id;
    doc.body.append(el);
  }
  globalThis.document = doc;

  // اجرای راه‌انداز
  const app = await import('../assets/js/app.js');
  await new Promise((r) => setTimeout(r, 30)); // اجازه به boot() برای تکمیل
  timers.flushTimers();

  // ۱) داده بارگذاری شده است
  assert.ok(app.store.products.length > 40, 'محصولات بارگذاری نشدند');
  const products = app.store.products.length;

  // ۲) بخش‌های اصلی رندر شده‌اند
  assert.ok(doc.getElementById('hero').innerHTML.includes('macro-cell'), 'بخش قهرمان رندر نشد');
  assert.ok(doc.getElementById('tabs').innerHTML.includes('data-key="deposits"'), 'برگه‌ها رندر نشدند');
  assert.ok(doc.getElementById('filters').innerHTML.includes('data-filter="bank"'), 'فیلترها رندر نشدند');
  assert.ok(doc.getElementById('cards').innerHTML.includes('class="card'), 'کارت‌ها رندر نشدند');
  assert.ok(doc.getElementById('charts').innerHTML.includes('<svg'), 'نمودارها رندر نشدند');
  assert.ok(doc.getElementById('footer').innerHTML.length > 100, 'پانویس رندر نشد');
  assert.equal(doc.getElementById('result-count').textContent.length > 0, true, 'شمارنده نتیجه پر نشد');
  const searchInput = doc.getElementById('global-search');
  assert.equal(searchInput.value, 'بلو', 'عبارت جست‌وجوی ذخیره‌شده باید در ورودی بازیابی شود');
  app.store.filters.query = '';
  searchInput.value = '';
  app.renderResults();

  // ۳) نوار ابزار باید کنترل مرتب‌سازی داشته باشد و پنل فیلتر همه فیلترهای پایه را
  const toolbarHTML = doc.getElementById('toolbar').innerHTML;
  assert.ok(toolbarHTML.includes('data-filter="sort"'), 'مرتب‌سازی در نوار ابزار نیست');
  for (const key of ['bank', 'minScore', 'channel', 'collateral', 'confidence', 'onlyFresh', 'onlyStale']) {
    assert.ok(
      doc.getElementById('filters').innerHTML.includes(`data-filter="${key}"`),
      `فیلتر «${key}» در پنل فیلترها رندر نشد`,
    );
  }

  // ۴) کلیک روی برگه «تسهیلات» از مسیر واقعی رویداد، داده را عوض می‌کند
  const depositsIds = app.filtered().map((p) => p.id).sort();

  // کلیک روی برگه «صندوق‌های درآمد ثابت» (دسته جدید)
  const fundsTab = new Element('button');
  fundsTab.setAttribute('data-action', 'category');
  fundsTab.setAttribute('data-key', 'funds');
  doc.body.append(fundsTab);

  fundsTab.dispatchEvent(makeEvent('click', { target: fundsTab }));
  timers.flushTimers();

  assert.equal(app.store.filters.category, 'funds', 'تغییر به دسته صندوق‌ها اعمال نشد');
  const fundRows = app.filtered();
  assert.ok(fundRows.length > 0, 'دسته صندوق‌های درآمد ثابت خالی است');
  assert.ok(fundRows.every((p) => p.category === 'funds'), 'نتایج باید همگی در دسته funds باشند');

  // عنصر دقیقاً مانند چیزی که views.js تولید می‌کند ساخته می‌شود
  const loansTab = new Element('button');
  loansTab.setAttribute('data-action', 'category');
  loansTab.setAttribute('data-key', 'loans');
  doc.body.append(loansTab);

  loansTab.dispatchEvent(makeEvent('click', { target: loansTab }));
  timers.flushTimers();

  assert.equal(app.store.filters.category, 'loans', 'تغییر دسته اعمال نشد');
  const loanRows = app.filtered();
  assert.ok(loanRows.length > 0, 'دسته تسهیلات خالی است');
  assert.ok(
    loanRows.every((p) => p.category === 'loans'),
    'نتایج شامل محصول خارج از دسته تسهیلات است',
  );
  const loanIds = loanRows.map((p) => p.id).sort();
  assert.notDeepEqual(loanIds, depositsIds, 'فهرست نتایج پس از تغییر دسته عوض نشد');

  // ۵) بازگشت به حالت اول و بررسی پایداری
  app.store.filters.category = 'deposits';
  assert.deepEqual(app.filtered().map((p) => p.id).sort(), depositsIds, 'بازگشت به دسته منابعی ناموفق بود');

  // ۶) جست‌وجوی مستقیم باید محصول دسته‌ای دیگر را نیز پیشنهاد و باز کند
  const suggestionList = doc.getElementById('search-suggestions');
  searchInput.value = 'وام ازدواج';
  searchInput.dispatchEvent(makeEvent('input', { target: searchInput }));
  assert.equal(searchInput.getAttribute('aria-expanded'), 'true', 'فهرست پیشنهادهای جست‌وجو باید باز شود');
  assert.match(suggestionList.innerHTML, /data-action="search-open"/, 'پیشنهاد مستقیم باید کنش بازکردن محصول داشته باشد');
  const firstProductId = suggestionList.innerHTML.match(/data-id="([^"]+)"/)?.[1];
  assert.ok(firstProductId, 'پیشنهاد باید شناسه محصول داشته باشد');

  const directResult = new Element('button');
  directResult.setAttribute('data-action', 'search-open');
  directResult.setAttribute('data-id', firstProductId);
  doc.body.append(directResult);
  directResult.dispatchEvent(makeEvent('click', { target: directResult }));

  const selectedProduct = app.store.products.find((p) => p.id === firstProductId);
  assert.ok(selectedProduct, 'محصول پیشنهادی باید در داده موجود باشد');
  assert.ok(doc.getElementById('drawer').classList.contains('is-open'), 'انتخاب پیشنهاد باید جزئیات محصول را باز کند');
  assert.ok(doc.getElementById('drawer').innerHTML.includes(selectedProduct.product));
  assert.equal(searchInput.getAttribute('aria-expanded'), 'false', 'با انتخاب محصول فهرست پیشنهاد باید بسته شود');

  const closeDirectResult = new Element('button');
  closeDirectResult.setAttribute('data-action', 'close-drawer');
  doc.body.append(closeDirectResult);
  closeDirectResult.dispatchEvent(makeEvent('click', { target: closeDirectResult }));
  assert.equal(doc.getElementById('drawer').classList.contains('is-open'), false, 'بستن جزئیات مستقیم باید کار کند');
  assert.equal(doc.activeElement, searchInput, 'پس از بستن جزئیات، تمرکز باید به جست‌وجو برگردد');

  searchInput.dispatchEvent(makeEvent('focus', { target: searchInput }));
  searchInput.dispatchEvent(makeEvent('keydown', { target: searchInput, key: 'ArrowDown' }));
  assert.equal(searchInput.getAttribute('aria-activedescendant'), 'search-option-0', 'کلید جهت‌نما باید پیشنهاد فعال بسازد');
  searchInput.dispatchEvent(makeEvent('keydown', { target: searchInput, key: 'Enter' }));
  assert.equal(doc.getElementById('drawer').classList.contains('is-open'), true, 'Enter باید محصول پیشنهادی فعال را باز کند');
  closeDirectResult.dispatchEvent(makeEvent('click', { target: closeDirectResult }));

  // ۷) شمارش کل محصولات تغییری نکرده است
  assert.equal(app.store.products.length, products, 'تعداد محصولات تغییر کرده است');
});

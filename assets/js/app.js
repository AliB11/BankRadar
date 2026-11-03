/**
 * راه‌انداز سامانه: اتصال وضعیت به نمایش و مدیریت تعامل کاربر.
 *
 * الگوی تعامل: همه رویدادها با delegation روی document مدیریت می‌شوند و
 * از data-action استفاده می‌کنند. بنابراین هیچ onclick درون‌خطی وجود ندارد
 * و مقدار داده هرگز به‌عنوان کد اجرا نمی‌شود.
 */

import {
  $, esc, fa, faNum, faToman, faPercent, debounce, storage, todayISO,
} from './util.js';
import {
  store, loadData, reloadFreshData, recalculate, filtered, searchProducts, summary, saveFilters, saveWeights,
  saveCompare, applyPreset, availableBanksIn, CATEGORY_META, CONTRACT_META, deriveContractType, resultOf,
} from './store.js';
import { DEFAULT_WEIGHTS, WEIGHT_META, PRESETS } from './score.js';
import { scheduleFor, scheduleLegacy, effectiveAnnualRate, realRate } from './finance.js';
import { buildXlsx } from './xlsx.js';
import * as view from './views.js';

/* ---------- اعلان ---------- */

const toastStack = () => $('#toast-stack');

function toast(message, tone = 'good') {
  const node = document.createElement('div');
  node.className = `toast toast--${tone}`;
  node.setAttribute('role', 'status');
  node.innerHTML = `<span aria-hidden="true">${
    tone === 'good' ? '✓' : tone === 'bad' ? '✕' : '⚠'
  }</span><span>${esc(message)}</span>`;
  toastStack().append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 320);
  }, 4200);
}

/* ---------- تم روشن/تیره ---------- */

const THEME_STORAGE_KEY = 'bank-radar-theme';

/** تم فعلی سند؛ پیش‌فرض تیره است و اسکریپت ابتدای index.html آن را زودتر می‌چیند. */
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * تغییر تم با ذخیرهٔ انتخاب کاربر.
 * اسکریپت کوچک ابتدای index.html تم را قبل از اولین رنگ‌آمیزی می‌چیند تا
 * «فلش تم نادرست» نداشته باشیم؛ اینجا فقط انتخاب را می‌چرخاند و می‌نویسد.
 */
function applyTheme(theme, { announce = false } = {}) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  storage.set(THEME_STORAGE_KEY, theme);
  document.querySelectorAll?.('[data-action="toggle-theme"]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(theme === 'light'));
    const lbl = btn.querySelector('.lbl');
    if (lbl) lbl.textContent = theme === 'light' ? 'تم تیره' : 'تم روشن';
    const ic = btn.querySelector('[data-theme-icon]');
    if (ic) ic.textContent = theme === 'light' ? '☾' : '☀';
  });
  if (announce) toast(theme === 'light' ? 'تم روشن فعال شد.' : 'تم تیره فعال شد.');
}

function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next, { announce: true });
}

/* ---------- رندر ---------- */

/**
 * تفکیک رندر به دو لایه انجام شده است:
 *
 *   renderFilters — پنل فیلترها و وزن‌ها؛ فقط زمانی ساخته می‌شود که ساختار عوض
 *                   شود (تغییر دسته، بازنشانی). اگر با هر ورودی لغزنده وزن
 *                   دوباره ساخته شود، کاربر حین کشیدن لغزنده تمرکز را از دست
 *                   می‌دهد و کشیدن نیمه‌کاره می‌ماند.
 *
 *   renderResults — برگه‌ها، نوار ابزار، کارت‌ها، رتبه‌بندی، مقایسه و نمودارها؛
 *                   با هر تغییر داده یا امتیاز به‌روزرسانی می‌شود.
 */
let resultsQueued = false;

function renderFilters() {
  const host = document.querySelector('#filters');
  if (host) host.innerHTML = view.filtersHTML();
}

/** بخش قهرمان (آمار و شاخص‌های کلان) — پس از بارگذاری داده تازه باید بازسازی شود */
function renderHero() {
  const host = document.querySelector('#hero');
  if (host) host.innerHTML = view.heroHTML();
}

function renderResults() {
  const rows = filtered();
  const root = document;

  root.querySelector('#tabs').innerHTML = view.tabsHTML();
  root.querySelector('#toolbar').innerHTML = view.toolbarHTML(rows);
  root.querySelector('#cards').innerHTML = view.cardsHTML(rows);
  root.querySelector('#rank').innerHTML = view.rankHTML(rows);
  root.querySelector('#compare').innerHTML = view.compareHTML();
  root.querySelector('#charts').innerHTML = view.chartsHTML(rows);

  // نتیجه زنده برای صفحه‌خوان‌ها
  const live = root.querySelector('#result-count');
  if (live) live.textContent = `${rows.length} محصول نمایش داده می‌شود`;

  // شمارنده مقایسه در نوار بالا
  const navCount = root.querySelector('#nav-compare-count');
  if (navCount) navCount.textContent = fa(store.compare.size);
}

/** رندر کامل (ساختار + نتایج) — برای راه‌اندازی و تغییرات ساختاری */
function render() {
  renderFilters();
  renderResults();
}

function renderSoon() {
  if (resultsQueued) return;
  resultsQueued = true;
  requestAnimationFrame(() => {
    resultsQueued = false;
    renderResults();
  });
}

/** به‌روزرسانی گزینه‌های بانک بدون بازسازی کل پنل */
function refreshBankOptions() {
  const select = document.querySelector('[data-filter="bank"]');
  if (!select) return;
  const banks = availableBanksIn(store.filters.category);
  const current = banks.includes(store.filters.bank) ? store.filters.bank : 'all';
  select.innerHTML = [
    `<option value="all">همه (${fa(banks.length)} مورد)</option>`,
    ...banks.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`),
  ].join('');
  select.value = current;
  store.filters.bank = current;
}

/* ---------- فیلترها ---------- */

function setFilter(key, value) {
  if (key === 'bank' || key === 'category') {
    store.filters[key] = value;
  } else if (key === 'minScore') {
    store.filters.minScore = Number(value) || 0;
  } else if (key === 'onlyFresh' || key === 'onlyStale') {
    store.filters[key] = Boolean(value);
  } else {
    store.filters[key] = value;
  }
  saveFilters();
  if (key === 'category') {
    refreshBankOptions();
    renderFilters();
  }
  renderSoon();
}

const SEARCH_RESULT_LIMIT = 6;
let directSearchMatches = [];
let activeSearchIndex = -1;

function hideSearchSuggestions() {
  const input = $('#global-search');
  const list = $('#search-suggestions');
  directSearchMatches = [];
  activeSearchIndex = -1;
  if (list) {
    list.innerHTML = '';
    list.setAttribute('hidden', '');
  }
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
}

function renderSearchSuggestions(query) {
  const input = $('#global-search');
  const list = $('#search-suggestions');
  if (!input || !list) return;

  const q = String(query ?? '').trim();
  if (Array.from(q.replace(/\s/g, '')).length < 2) {
    hideSearchSuggestions();
    return;
  }

  directSearchMatches = searchProducts(q, { limit: SEARCH_RESULT_LIMIT });
  activeSearchIndex = -1;
  list.innerHTML = directSearchMatches.length
    ? directSearchMatches.map((p, index) => {
        const category = CATEGORY_META[p.category];
        const rate = p.rateKnown === false || p.rateKind === 'none'
          ? 'اطلاعات نرخ ندارد'
          : `${p.rateKind === 'fee' ? 'کارمزد' : 'نرخ'} ${faPercent(p.rate)}`;
        return `<button class="search-suggestion" type="button" role="option"
          id="search-option-${index}" data-action="search-open" data-id="${esc(p.id)}"
          data-index="${index}" tabindex="-1" aria-selected="false">
          <span class="search-suggestion__main">
            <span class="search-suggestion__name">${esc(p.product)}</span>
            <span class="search-suggestion__meta">${esc(p.bank)} · ${esc(category?.title ?? 'محصول بانکی')}</span>
          </span>
          <span class="search-suggestion__side">
            <span class="search-suggestion__rate">${esc(rate)}</span>
            <span class="search-suggestion__category">${esc(category?.short ?? '')}</span>
          </span>
        </button>`;
      }).join('')
    : '<div class="search-suggestions__empty" role="option" aria-disabled="true">محصولی با این عبارت پیدا نشد.</div>';
  list.removeAttribute('hidden');
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
}

function setActiveSearchSuggestion(nextIndex) {
  if (!directSearchMatches.length) return;
  const count = directSearchMatches.length;
  activeSearchIndex = (nextIndex + count) % count;
  const input = $('#global-search');
  input?.setAttribute('aria-activedescendant', `search-option-${activeSearchIndex}`);
  document.querySelectorAll('.search-suggestion').forEach((option, index) => {
    option.setAttribute('aria-selected', String(index === activeSearchIndex));
  });
}

function selectSearchProduct(productId) {
  const product = store.products.find((p) => p.id === productId);
  if (!product) return;
  hideSearchSuggestions();
  openDrawer(product.id, $('#global-search'));
}

function resetFilters() {
  const category = store.filters.category;
  store.filters = {
    query: '',
    bank: 'all',
    minScore: 0,
    channel: 'all',
    collateral: 'all',
    confidence: 'all',
    contract: 'all',
    category,
    sort: 'score',
    onlyFresh: false,
    onlyStale: false,
  };
  const input = $('#global-search');
  if (input) input.value = '';
  hideSearchSuggestions();
  saveFilters();
  render();
  toast('فیلترها پاک شد. وزن‌های امتیازدهی دست‌نخورده ماند.');
}

function resetWeights() {
  store.weights = { ...DEFAULT_WEIGHTS };
  store.activePreset = 'balanced';
  saveWeights();
  recalculate();
  renderFilters();
  renderSoon();
  toast('وزن‌ها به حالت متعادل بازگشت.');
}

/* ---------- مقایسه ---------- */

/**
 * همگام‌سازی سبد مقایسه با نشانی صفحه (#compare=id1,id2,...).
 *
 * چرا hash و نه query: hash هرگز درخواست شبکه جدید نمی‌سازد و با
 * history.replaceState هم تاریخچه مرورگر آلوده نمی‌شود؛ «کپی لینک» هر لحظه
 * معتبر است. شناسه‌های محصول پایدارند (id از خود داده می‌آید)، پس لینک بین
 * کاربرها و بین نسخه‌های داده معنا دارد؛ شناسه‌های ناشناخته بی‌سروصدا
 * حذف می‌شوند نه اینکه صفحه را بشکنند.
 */
function syncCompareHash() {
  const ids = [...store.compare].join(',');
  const url = ids ? `${location.pathname}#compare=${ids}` : location.pathname;
  history.replaceState(null, '', url);
}

/** بازخوانی سبد مقایسه از لینک اشتراکی (اگر بود) — بر ذخیرهٔ محلی اولویت دارد. */
function restoreCompareFromHash() {
  const match = /^#compare=(.+)$/.exec(location.hash || '');
  if (!match) return null;
  const ids = match[1]
    .split(',')
    .filter((id) => id && store.products.some((p) => p.id === id))
    .slice(0, 8);
  if (!ids.length) return null;
  store.compare = new Set(ids);
  saveCompare();
  return ids;
}

/** حالت تمام‌عرض جدول مقایسه — وضعیت روی body می‌ماند تا با هر رندر مجدد نپرد. */
function toggleCompareFullscreen() {
  const section = document.querySelector('#compare-section');
  if (!section) return;
  const on = document.body.classList.toggle('compare-zoom');
  document.body.style.overflow = on ? 'hidden' : '';
  if (!on && !drawer().classList.contains('is-open')) document.body.style.overflow = '';
  section.querySelector('[data-action="compare-fullscreen"]')?.scrollIntoView({ block: 'nearest' });
}

async function copyCompareLink() {
  syncCompareHash();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('لینک مقایسه کپی شد؛ همین نشانی انتخاب شما را برای دیگران باز می‌کند.');
  } catch {
    // محیط‌های بدون مجوز clipboard — لینک کامل در پیام می‌آید تا دستی کپی شود
    toast(`کپی خودکار ممکن نشد — لینک مقایسه: ${url}`, 'warn');
  }
}

function toggleCompare(id) {
  if (store.compare.has(id)) store.compare.delete(id);
  else {
    if (store.compare.size >= 8) {
      toast('حداکثر ۸ محصول را می‌توان هم‌زمان مقایسه کرد.', 'warn');
      return;
    }
    store.compare.add(id);
  }
  saveCompare();
  syncCompareHash();
  renderSoon();
}

/* ---------- کشو جزئیات ---------- */

const drawer = () => $('#drawer');
const backdrop = () => $('#drawer-backdrop');
let drawerReturnFocus = null;

function openDrawer(id, returnFocus = document.activeElement) {
  const p = store.products.find((x) => x.id === id);
  if (!p) return;
  if (!drawer().classList.contains('is-open')) drawerReturnFocus = returnFocus;
  drawer().innerHTML = view.detailHTML(p);
  drawer().classList.add('is-open');
  drawer().setAttribute('aria-hidden', 'false');
  backdrop().classList.add('is-open');
  document.body.style.overflow = 'hidden';
  drawer().querySelector('[data-action="close-drawer"]')?.focus();
  if ((p.category === 'loans' || p.category === 'credit') && p.maxAmount) {
    updateCalculator(drawer());
  }
}

function closeDrawer() {
  drawer().classList.remove('is-open');
  drawer().setAttribute('aria-hidden', 'true');
  backdrop().classList.remove('is-open');
  document.body.style.overflow = '';
  const returnFocus = drawerReturnFocus;
  drawerReturnFocus = null;
  returnFocus?.focus?.();
}

/* ---------- ماشین‌حساب ---------- */

function updateCalculator(scope) {
  const calc = scope.querySelector('[data-calc]');
  if (!calc) return;
  const out = calc.querySelector('[data-calc-out]');
  const amountEl = calc.querySelector('[data-calc-input="amount"]');
  const monthsEl = calc.querySelector('[data-calc-input="months"]');
  const rateEl = calc.querySelector('[data-calc-input="rate"]');
  const upfrontEl = calc.querySelector('[data-calc-input="upfront"]');

  // محدودسازی دستی مقادیر تایپ‌شده: ویژگی‌های min/max فقط روی دکمه‌های چرخان
  // اثر دارند و کاربر می‌تواند با تایپ آزاد، عدد منفی یا ماهِ ۹۹۹ وارد کند؛
  // محاسبه باید روی همان بازهٔ معتبر انجام شود.
  const amount = Math.max(0, Number(amountEl.value) || 0) * 1e6;
  const months = Math.min(360, Math.max(1, Math.round(Number(monthsEl.value) || 12)));
  if (String(rateEl.value).trim() === '') {
    out.innerHTML = '<div>نرخ محصول نامشخص است؛ برای برآورد، نرخ قراردادی را وارد کنید.</div>';
    return;
  }
  const rate = Math.min(100, Math.max(0, Number(rateEl.value) || 0));

  // نوع محاسبه از رکورد می‌آید؛ نرخ پایین به‌تنهایی نشانه کارمزد نیست.
  const product = store.products.find((x) => x.id === calc.dataset.id) ?? { rate, rateKind: 'profit' };
  const model = { ...product, rate, rateKnown: true };
  const monthsClamped = Math.max(1, Math.round(months));

  const std = scheduleFor(model, amount, monthsClamped);
  const leg = scheduleLegacy(amount, rate, monthsClamped);
  if (!std) { out.innerHTML = '<div>روش محاسبه کارمزد نامشخص است.</div>'; return; }
  const upfrontFee = Math.min(99, Math.max(0, Number(upfrontEl?.value) || 0));
  const eff = effectiveAnnualRate(model, amount, monthsClamped, upfrontFee);
  const inflation = store.indicators?.inflationAnnual?.value ?? null;
  const real = inflation != null && eff != null ? realRate(eff, inflation) : null;

  const isFee = model.rateKind === 'fee';
  const costLabel = isFee ? 'کل کارمزد' : 'کل سود پرداختی';
  const firstLabel = isFee ? 'قسط معمول اصل' : 'قسط ماهانه (روش جدید)';

  // یادآوری محدوده: مبلغ خارج از سقف/حداقل واقعی محصول، برآورد را از واقعیت
  // دور می‌کند؛ پیام کوتاه، کاربر را درجا آگاه می‌کند.
  const rangeNote = [
    product.minAmount && amount < product.minAmount
      ? `<div style="grid-column:1/-1;font-size:var(--fs-3xs);color:var(--warn)">⚠️ مبلغ واردشده کمتر از حداقل این محصول (${esc(faToman(product.minAmount))}) است.</div>`
      : '',
    product.maxAmount && amount > product.maxAmount
      ? `<div style="grid-column:1/-1;font-size:var(--fs-3xs);color:var(--warn)">⚠️ مبلغ واردشده بیش از سقف این محصول (${esc(faToman(product.maxAmount))}) است.</div>`
      : '',
  ].join('');

  out.innerHTML = `
    <div><span class="k">${firstLabel}</span><span class="v num" style="color:var(--brand)">${faToman(std.installment, { short: false })}</span></div>
    ${isFee && std.firstFee != null ? `<div><span class="k">کارمزد سال نخست</span><span class="v num">${faToman(std.firstFee, { short: false })}</span></div>` : ''}
    ${isFee ? '' : `<div><span class="k">قسط ماهانه (روش قدیمی)</span><span class="v num">${faToman(leg.installment, { short: false })}</span></div>`}
    <div><span class="k">${costLabel}</span><span class="v num">${faToman(std.totalInterest, { short: false })}</span></div>
    <div><span class="k">مجموع بازپرداخت</span><span class="v num">${faToman(std.totalPayment, { short: false })}</span></div>
    <div><span class="k">نرخ مؤثر سالانه${upfrontFee ? ` (با کسر ${fa(upfrontFee)}٪)` : ' (بدون هزینه کسر اولیه)'}</span><span class="v num" style="color:var(--warn)">${faPercent(eff, 2)}</span></div>
    ${real != null ? `<div><span class="k">هزینه حقیقی در برابر تورم</span><span class="v num" style="color:${real < 0 ? 'var(--brand)' : 'var(--danger)'}">${faPercent(real)}</span></div>` : ''}
    ${rangeNote}
  `;

}

function resetCalculator(scope) {
  const calc = scope.querySelector('[data-calc]');
  if (!calc) return;
  const p = store.products.find((x) => x.id === calc.dataset.id);
  if (!p) return;
  calc.querySelector('[data-calc-input="amount"]').value = Math.round((p.maxAmount || 100_000_000) / 1e6);
  calc.querySelector('[data-calc-input="months"]').value = p.termMonths || 36;
  calc.querySelector('[data-calc-input="rate"]').value = p.rateKnown === false ? '' : p.rate;
  const upfront = calc.querySelector('[data-calc-input="upfront"]');
  if (upfront) upfront.value = 0;
  updateCalculator(scope);
}

/* ---------- گفتگوها ---------- */

function openModal(id, htmlContent) {
  const node = $(id);
  node.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${htmlContent}</div>`;
  node.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  node.querySelector('[data-action^="close"]')?.focus();
}

function closeModal(id) {
  const node = $(id);
  node.classList.remove('is-open');
  node.innerHTML = '';
  if (!drawer().classList.contains('is-open')) document.body.style.overflow = '';
}

/* ---------- خروجی ---------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CSV_COLUMNS = [
  'id', 'bank', 'product', 'category', 'subcategory', 'rate', 'rateKnown', 'rateKind', 'feeModel', 'availability',
  'contractType',
  'minAmount', 'maxAmount', 'termMonths', 'collateralKind', 'collateral',
  'confidence', 'autoDiscovered', 'stale', 'lastUpdated', 'sourceUrl',
];

function exportCSV() {
  const rows = store.compare.size
    ? store.products.filter((p) => store.compare.has(p.id))
    : filtered();

  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [CSV_COLUMNS.join(',')];
  for (const p of rows) {
    lines.push(
      CSV_COLUMNS.map((c) => {
        if (c === 'sourceUrl') return csvEscape(p.source?.url ?? '');
        return csvEscape(p[c]);
      }).join(','),
    );
  }
  // BOM برای نمایش صحیح فارسی در Excel
  download(`bank-radar-${todayISO()}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
  toast(`${fa(rows.length)} رکورد در قالب CSV خروجی گرفته شد.`);
}

function exportJSON() {
  const payload = {
    generatedAt: new Date().toISOString(),
    counts: { total: store.products.length },
    weights: store.weights,
    filters: store.filters,
    products: store.products,
  };
  download(`bank-radar-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('خروجی JSON ساخته شد.');
}

/* ---------- خروجی اکسل ---------- */

/**
 * خروجی اکسل (.xlsx) سه‌برگه‌ای، بدون هیچ وابستگی خارجی (assets/js/xlsx.js).
 *
 * دامنهٔ ردیف‌ها با CSV یکی است: اگر سبدهای مقایسه چیزی دارد همان‌ها، وگرنه
 * نتیجهٔ فیلترهای جاری — یعنی «خروجی همان چیزی که می‌بینی».
 *
 * برگهٔ «محصولات» اعداد کلیدی (نرخ، سقف، امتیاز، بازده حقیقی) را به‌صورت سلول
 * عددی می‌نویسد تا کاربر بتواند در اکسل مرتب‌سازی و فرمول بزند؛ برگهٔ «شاخص‌های
 * کلان» و «خلاصه» زمینهٔ تصمیم و شرایط تولید داده را کنار جدول می‌آورند تا
 * گزارش بدون این صفحهٔ وب هم خودکفا باشد.
 */
function exportExcel() {
  const rows = store.compare.size
    ? store.products.filter((p) => store.compare.has(p.id))
    : filtered();

  const inflation = store.indicators?.inflationAnnual?.value ?? null;
  const checkedOf = (p) => p.lastSeen || p.lastVerified || p.source?.checked || p.lastUpdated || '';

  const productRows = rows.map((p) => {
    const result = resultOf(p.id);
    return [
      p.bank,
      p.product,
      CATEGORY_META[p.category]?.title ?? p.category,
      p.subcategory || '',
      p.rateKnown === false || p.rateKind === 'none' ? null : p.rate,
      p.rateKind === 'fee' ? 'کارمزد' : p.rateKind === 'none' ? 'بدون نرخ' : 'سود',
      p.maxAmount ?? null,
      p.minAmount ?? null,
      p.termMonths ?? null,
      result.score ?? null,
      result.realRate ?? null,
      p.collateral || '',
      p.collateralKind || '',
      p.confidence || '',
      p.stale ? 'بله' : 'خیر',
      p.availability === 'historical' ? 'تاریخی' : 'فعال',
      checkedOf(p),
      p.lastUpdated || '',
      p.source?.url || '',
      p.desc || '',
    ];
  });

  const indicatorRows = Object.entries(store.indicators ?? {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => [key, v.label ?? '', typeof v.value === 'number' ? v.value : null, v.period ?? '', v.sourceKind ?? '']);

  const s = summary();
  const summaryRows = [
    ['تاریخ تولید گزارش', todayISO()],
    ['تعداد کل محصولات', s.total],
    ['تعداد بانک / نهاد', s.banks],
    ['میانگین امتیاز جذابیت', s.avgScore],
    ['تورم سالانه مرجع (%)', inflation],
    ['آخرین اجرای خط لوله', store.meta?.lastRun ?? ''],
    ['نوع اجرا', store.meta?.lastRunMode ?? ''],
    ['دامنهٔ ردیف‌ها', store.compare.size ? `سبد مقایسه (${rows.length} محصول)` : `فیلترهای جاری (${rows.length} محصول)`],
    ...Object.entries(store.filters ?? {}).map(([k, v]) => [`فیلتر: ${k}`, String(v)]),
    ...Object.entries(store.weights ?? DEFAULT_WEIGHTS).map(([k, v]) => [`وزن: ${WEIGHT_META[k]?.label ?? k}`, v]),
    ...Object.entries(CATEGORY_META).map(([key, meta]) => [`دسته: ${meta.title}`, s.byCategory[key] ?? 0]),
  ];

  const bytes = buildXlsx([
    {
      name: 'محصولات',
      columns: [
        'بانک / نهاد', 'محصول', 'دسته', 'زیردسته', 'نرخ یا کارمزد (٪)', 'نوع نرخ',
        'سقف (تومان)', 'حداقل (تومان)', 'مدت (ماه)', 'امتیاز جذابیت', 'بازده/هزینه حقیقی (٪)',
        'وثیقه', 'نوع وثیقه', 'اطمینان منبع', 'نیازمند بازبینی', 'وضعیت عرضه',
        'آخرین کنترل', 'به‌روزرسانی منبع', 'لینک منبع', 'توضیح',
      ],
      rows: productRows,
      widths: [22, 30, 12, 14, 14, 9, 16, 16, 9, 12, 17, 18, 13, 12, 12, 11, 13, 13, 30, 44],
    },
    {
      name: 'شاخص‌های کلان',
      columns: ['کلید', 'عنوان', 'مقدار', 'دوره', 'نوع منبع'],
      rows: indicatorRows,
      widths: [22, 34, 12, 14, 12],
    },
    {
      name: 'خلاصه',
      columns: ['ستون', 'مقدار'],
      rows: summaryRows,
      widths: [30, 44],
    },
  ]);

  download(`bank-radar-${todayISO()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast(`${fa(rows.length)} رکورد در قالب اکسل (سه برگه) خروجی گرفته شد.`);
}

/* ---------- بارگذاری داده دستی ---------- */

function importJSON() {
  const area = $('[data-field="json-input"]');
  if (!area?.value.trim()) {
    toast('ابتدا محتوای JSON را جای‌گذاری کنید.', 'warn');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(area.value);
  } catch (err) {
    toast(`JSON نامعتبر است: ${err.message}`, 'bad');
    return;
  }
  const rows = Array.isArray(parsed) ? parsed : parsed.products;
  if (!Array.isArray(rows) || !rows.length) {
    toast('ساختار JSON باید آرایه‌ای از محصولات باشد.', 'bad');
    return;
  }
  const valid = rows.filter((r) => r && typeof r === 'object' && (r.product || r.name));
  if (!valid.length) {
    toast('هیچ رکورد معتبری یافت نشد (فیلد product الزامی است).', 'bad');
    return;
  }
  storage.set('customProducts', valid);
  const merged = mergeLocal(valid);
  store.products = merged;
  recalculate();
  render();
  closeModal('#data-modal');
  toast(`${fa(valid.length)} رکورد محلی بارگذاری شد. برای اعمال دائمی، data/products.json را به‌روزرسانی کنید.`);
}

function mergeLocal(rows) {
  const base = [...store.products];
  const index = new Map(base.map((p, i) => [p.id, i]));
  // مقدار عددی معتبر — صفر هم مقدار قانونی است و نباید با fallback عوض شود
  const numLike = (v, fallback) =>
    v == null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v);
  for (const raw of rows) {
    const normalized = {
      id: raw.id || `local-${Math.random().toString(36).slice(2, 9)}`,
      bank: raw.bank || 'نامشخص',
      product: raw.product || raw.name,
      category: CATEGORY_META[raw.category] ? raw.category : 'loans',
      subcategory: raw.subcategory || 'local',
      rate: numLike(raw.rate, 0),
      rateKind: raw.rateKind || 'profit',
      benefit: numLike(raw.benefit, 55),
      minAmount: raw.minAmount ?? null,
      maxAmount: raw.maxAmount ?? null,
      amountLabel: raw.amountLabel || '',
      termMonths: raw.termMonths ?? null,
      termLabel: raw.termLabel || '',
      speed: numLike(raw.speed, 55),
      digital: numLike(raw.digital, 55),
      friction: numLike(raw.friction, 55),
      collateral: raw.collateral || 'نامشخص',
      collateralKind: raw.collateralKind || 'mixed',
      audience: raw.audience || '',
      desc: raw.desc || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
      confidence: raw.confidence || 'medium',
      regulatory: false,
      autoDiscovered: false,
      stale: false,
      lastUpdated: raw.lastUpdated || todayISO(),
      source: raw.source || { title: 'بارگذاری محلی', url: '' },
      extra: {},
      local: true,
    };
    // نوع عقد: مقدار صریح داده اولویت دارد و در نبود آن از خود رکورد استنتاج می‌شود.
    normalized.contractType = CONTRACT_META[raw.contractType] ? raw.contractType : deriveContractType(normalized);
    const at = index.get(normalized.id);
    if (at != null) base[at] = normalized;
    else {
      index.set(normalized.id, base.length);
      base.push(normalized);
    }
  }
  return base;
}

function resetLocal() {
  storage.remove('customProducts');
  storage.remove('compare');
  storage.remove('filters');
  storage.remove('weights');
  toast('داده محلی و تنظیمات پاک شد. صفحه بازخوانی می‌شود…');
  setTimeout(() => location.reload(), 700);
}

/* ---------- همگام‌سازی دستی و زنده ---------- */

async function manualRefresh() {
  const btns = document.querySelectorAll?.('[data-action="manual-refresh"], [data-action="sync-data-now"]') ?? [];
  const icons = document.querySelectorAll?.('.refresh-icon') ?? [];

  icons.forEach((ic) => ic.classList.add('is-spinning'));
  btns.forEach((b) => b.setAttribute('disabled', 'true'));

  toast('در حال استعلام و همگام‌سازی آخرین تغییرات داده…', 'warn');

  let serverSynced = false;
  try {
    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);

    if (res && res.ok) {
      const data = await res.json();
      if (data?.ok) serverSynced = true;
    }
  } catch {
    // در محیط ایستا درگاه سرور در دسترس نیست
  }

  const reloadRes = await reloadFreshData();
  icons.forEach((ic) => ic.classList.remove('is-spinning'));
  btns.forEach((b) => b.removeAttribute('disabled'));

  if (reloadRes.ok) {
    renderHero();
    renderFilters();
    renderSoon();
    renderFooter();
    toast(
      serverSynced
        ? `✓ همگام‌سازی زنده سرور انجام شد (${fa(reloadRes.count)} محصول).`
        : `✓ بازخوانی از آخرین نسخه منتشرشده انجام شد (${fa(reloadRes.count)} محصول) — همگام‌سازی زنده سرور در این محیط فعال نیست.`,
      'good',
    );
  } else {
    toast(`خطا در بازخوانی داده‌ها: ${reloadRes.error}`, 'bad');
  }
}

/* ---------- رویدادها ---------- */

function bindEvents() {
  // جست‌وجوی مستقیم در همه دسته‌ها + فیلتر زنده فهرست جاری
  const search = $('#global-search');
  const applySearchFilter = debounce((query) => setFilter('query', query), 220);
  search.value = store.filters.query || '';
  search.addEventListener('input', (e) => {
    renderSearchSuggestions(e.target.value);
    applySearchFilter(e.target.value);
  });
  search.addEventListener('focus', () => renderSearchSuggestions(search.value));
  search.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.activeElement?.closest?.('.topbar-search')) hideSearchSuggestions();
    }, 0);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && directSearchMatches.length) {
      e.preventDefault();
      setActiveSearchSuggestion(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1);
    } else if (e.key === 'ArrowUp' && directSearchMatches.length) {
      e.preventDefault();
      setActiveSearchSuggestion(activeSearchIndex < 0 ? directSearchMatches.length - 1 : activeSearchIndex - 1);
    } else if (e.key === 'Enter' && directSearchMatches.length) {
      e.preventDefault();
      const selected = directSearchMatches[activeSearchIndex < 0 ? 0 : activeSearchIndex];
      selectSearchProduct(selected.id);
    } else if (e.key === 'Escape' && search.getAttribute('aria-expanded') === 'true') {
      e.preventDefault();
      hideSearchSuggestions();
    }
  });

  // تغییر فیلترها و وزن‌ها
  document.addEventListener('change', (e) => {
    const t = e.target;

    if (t.dataset.filter) {
      const key = t.dataset.filter;
      const value = t.type === 'checkbox' ? t.checked : t.value;
      setFilter(key, value);
      return;
    }

    if (t.dataset.calcInput) {
      updateCalculator(t.closest('.drawer, .modal') ?? document);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.weight) {
      const key = t.dataset.weight;
      store.weights[key] = Number(t.value) || 0;
      store.activePreset = null;
      const label = document.querySelector(`[data-weight-value="${key}"]`);
      if (label) label.textContent = fa(store.weights[key]);
      document.querySelectorAll('[data-action="preset"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      saveWeights();
      recalculate();
      renderSoon(); // فقط نتایج؛ پنل وزن‌ها دست‌نخورده می‌ماند تا کشیدن لغزنده قطع نشود
      return;
    }
    if (t.dataset.calcInput) {
      updateCalculator(t.closest('.drawer, .modal') ?? document);
    }
  });

  // کلیک‌ها
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search')) hideSearchSuggestions();
    const actionEl = e.target.closest('[data-action]');

    // بستن کشو با کلیک روی پس‌زمینه
    if (!actionEl) {
      if (e.target === backdrop()) closeDrawer();
      if (e.target.classList?.contains('modal-backdrop')) closeModal(`#${e.target.id}`);
      return;
    }

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case 'category':
        setFilter('category', actionEl.dataset.key);
        document.querySelector('#cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'preset':
        applyPreset(actionEl.dataset.key);
        renderFilters();
        renderSoon();
        toast(`پروفایل «${PRESETS[actionEl.dataset.key]?.label}» اعمال شد.`);
        break;
      case 'reset-filters':
        resetFilters();
        break;
      case 'reset-weights':
        resetWeights();
        break;
      case 'toggle-compare':
        toggleCompare(id);
        break;
      case 'detail':
        openDrawer(id);
        break;
      case 'search-open':
        selectSearchProduct(id);
        break;
      case 'close-drawer':
        closeDrawer();
        break;
      case 'clear-compare':
        store.compare.clear();
        saveCompare();
        syncCompareHash();
        document.body.classList.remove('compare-zoom');
        if (!drawer().classList.contains('is-open')) document.body.style.overflow = '';
        renderSoon();
        toast('فهرست مقایسه پاک شد.');
        break;
      case 'compare-fullscreen':
        toggleCompareFullscreen();
        break;
      case 'copy-compare-link':
        copyCompareLink();
        break;
      case 'scroll-compare':
        document.querySelector('#compare')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'calc-reset':
        resetCalculator(actionEl.closest('.drawer, .modal') ?? document);
        break;
      case 'manual-refresh':
      case 'sync-data-now':
        manualRefresh();
        break;
      case 'open-data':
        openModal('#data-modal', view.dataModalHTML());
        break;
      case 'close-data':
        closeModal('#data-modal');
        break;
      case 'open-method':
        openModal('#method-modal', view.methodModalHTML());
        break;
      case 'close-method':
        closeModal('#method-modal');
        break;
      case 'download-csv':
        exportCSV();
        break;
      case 'download-xlsx':
        exportExcel();
        break;
      case 'download-json':
        exportJSON();
        break;
      case 'import-json':
        importJSON();
        break;
      case 'reset-local':
        resetLocal();
        break;
      case 'scroll-top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      default:
        break;
    }
  });

  // کلیدها
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.body.classList.contains('compare-zoom')) {
        document.body.classList.remove('compare-zoom');
        if (!drawer().classList.contains('is-open')) document.body.style.overflow = '';
      } else if (drawer().classList.contains('is-open')) closeDrawer();
      else if ($('#data-modal').classList.contains('is-open')) closeModal('#data-modal');
      else if ($('#method-modal').classList.contains('is-open')) closeModal('#method-modal');
      return;
    }
    // میان‌بر جست‌وجو — وقتی کاربر در حال تایپ در فیلدی است، کلید «/» باید
    // همان نویسه وارد شود و کار نباید به جست‌وجو بپرد.
    const ae = document.activeElement;
    const typing =
      !!ae &&
      (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable === true);
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === '/' && document.activeElement !== search && !typing) {
      e.preventDefault();
      search.focus();
      search.select();
    }
  });

  // حفظ تمرکز در کشو
  drawer().addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = drawer().querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/* ---------- راه‌اندازی ---------- */

async function boot() {
  const loading = $('#loading');
  try {
    const ok = await loadData();
    if (!ok) {
      if (loading) {
        loading.innerHTML = `
        <div class="empty-state">
          <span class="ic" aria-hidden="true">📭</span>
          <h3>داده‌ای برای نمایش وجود ندارد</h3>
          <p>${esc(store.lastError || 'فایل داده پیدا نشد.')}</p>
          <p>برای رفع مشکل، در ریشه پروژه دستور <code>npm run collect:offline</code> را اجرا کنید تا
          فایل <code>data/bundle.js</code> ساخته شود.</p>
        </div>`;
      }
      return;
    }

    // لینک اشتراکی مقایسه — پیش از اولین رندر، تا سکشن مقایسه از همان بار
    // اول با سبد درست ساخته شود و گره هدفِ اسکرول با رندر مجدد جایگزین نشود.
    const restoredIds = restoreCompareFromHash();

    renderHero();
    render();
    renderFooter();
    bindEvents();
    applyTheme(currentTheme()); // هم‌گام‌سازی برچسب و aria دکمهٔ تم با اسکریپت ابتدای صفحه

    if (restoredIds?.length) {
      toast(`${fa(restoredIds.length)} محصول از لینک اشتراکی به مقایسه اضافه شد.`);
      // اسکرول با scrollTo محاسبه‌شده: scrollIntoView در برخی محیط‌ها بی‌اثر است
      // و scroll-padding نوار بالا را هم باید خودمان لحاظ کنیم.
      requestAnimationFrame(() => {
        const section = document.querySelector('#compare-section');
        if (section) {
          window.scrollTo({
            top: section.getBoundingClientRect().top + window.scrollY - 84,
            behavior: 'instant',
          });
        }
      });
    }

    // بارگذاری داده محلی ذخیره‌شده
    const custom = storage.get('customProducts');
    if (Array.isArray(custom) && custom.length) {
      store.products = mergeLocal(custom);
      recalculate();
      render();
    }

    loading?.remove();
    announceReady();
  } catch (err) {
    if (loading) loading.innerHTML = `
      <div class="empty-state">
        <span class="ic" aria-hidden="true">⚠️</span>
        <h3>خطا در راه‌اندازی سامانه</h3>
        <p>${esc(err.message)}</p>
      </div>`;
    console.error('[bank-radar]', err);
  }
}

function renderFooter() {
  const footer = $('#footer');
  if (footer) footer.innerHTML = view.footerHTML();
}

function announceReady() {
  const s = summary();
  const live = $('#boot-status');
  if (live) {
    live.textContent = `سامانه با ${s.total} محصول از ${s.banks} بانک آماده است. میانگین امتیاز جذابیت ${s.avgScore} از ۱۰۰.`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// دسترسی برای اشکال‌زدایی در کنسول و آزمون‌های یکپارچگی
globalThis.bankRadar = { store, render, renderResults, renderFilters, recalculate, filtered, summary, toggleCompare, openDrawer };

export { store, render, renderResults, renderFilters, recalculate, filtered, summary, toggleCompare, openDrawer };

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
  store, loadData, reloadFreshData, recalculate, filtered, summary, saveFilters, saveWeights,
  saveCompare, applyPreset, availableBanksIn, CATEGORY_META, CONTRACT_META, deriveContractType,
} from './store.js';
import { DEFAULT_WEIGHTS, WEIGHT_META, PRESETS } from './score.js';
import { scheduleFor, scheduleLegacy, effectiveAnnualRate, realRate } from './finance.js';
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
  renderSoon();
}

/* ---------- کشو جزئیات ---------- */

const drawer = () => $('#drawer');
const backdrop = () => $('#drawer-backdrop');

function openDrawer(id) {
  const p = store.products.find((x) => x.id === id);
  if (!p) return;
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
}

/* ---------- ماشین‌حساب ---------- */

function updateCalculator(scope) {
  const calc = scope.querySelector('[data-calc]');
  if (!calc) return;
  const out = calc.querySelector('[data-calc-out]');
  const amountEl = calc.querySelector('[data-calc-input="amount"]');
  const monthsEl = calc.querySelector('[data-calc-input="months"]');
  const rateEl = calc.querySelector('[data-calc-input="rate"]');

  const amount = (Number(amountEl.value) || 0) * 1e6;
  const months = Math.max(1, Number(monthsEl.value) || 12);
  const rate = Math.max(0, Number(rateEl.value) || 0);

  // شیوه محاسبه از خود محصول می‌آید، نه از نرخ عددی: در وام‌های قرض‌الحسنه
  // عدد ۴ یک کارمزد یک‌بار است و اگر نرخ سالانه فرض شود، هزینه چند برابر
  // واقعیت نمایش داده می‌شود.
  const product = store.products.find((x) => x.id === calc.dataset.id) ?? {
    rate,
    rateKind: rate <= 6 ? 'fee' : 'profit',
  };
  const model = { ...product, rate };
  const monthsClamped = Math.max(1, Math.round(months));

  const std = scheduleFor(model, amount, monthsClamped);
  const leg = scheduleLegacy(amount, rate, monthsClamped);
  const upfrontFee = model.rateKind !== 'fee' && rate >= 20 ? 4 : 0;
  const eff = effectiveAnnualRate(model, amount, monthsClamped, upfrontFee);
  const inflation = store.indicators?.inflationAnnual?.value ?? null;
  const real = inflation != null ? realRate(eff, inflation) : null;

  const isFee = model.rateKind === 'fee';
  const costLabel = isFee ? 'کل کارمزد' : 'کل سود پرداختی';
  const firstLabel = isFee ? 'قسط ماهانه' : 'قسط ماهانه (روش جدید)';

  out.innerHTML = `
    <div><span class="k">${firstLabel}</span><span class="v num" style="color:var(--brand)">${faToman(std.installment)}</span></div>
    ${isFee ? '' : `<div><span class="k">قسط ماهانه (روش قدیمی)</span><span class="v num">${faToman(leg.installment)}</span></div>`}
    <div><span class="k">${costLabel}</span><span class="v num">${faToman(std.totalInterest)}</span></div>
    <div><span class="k">مجموع بازپرداخت</span><span class="v num">${faToman(std.totalPayment)}</span></div>
    <div><span class="k">نرخ مؤثر سالانه${upfrontFee ? ` (با کارمزد ${fa(upfrontFee)}٪)` : ''}</span><span class="v num" style="color:var(--warn)">${faPercent(eff)}</span></div>
    ${real != null ? `<div><span class="k">هزینه حقیقی در برابر تورم</span><span class="v num" style="color:${real < 0 ? 'var(--brand)' : 'var(--danger)'}">${faPercent(real)}</span></div>` : ''}
  `;

}

function resetCalculator(scope) {
  const calc = scope.querySelector('[data-calc]');
  if (!calc) return;
  const p = store.products.find((x) => x.id === calc.dataset.id);
  if (!p) return;
  calc.querySelector('[data-calc-input="amount"]').value = Math.round((p.maxAmount || 100_000_000) / 1e6);
  calc.querySelector('[data-calc-input="months"]').value = p.termMonths || 36;
  calc.querySelector('[data-calc-input="rate"]').value = p.rate || 23;
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
  'id', 'bank', 'product', 'category', 'subcategory', 'rate', 'rateKind',
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
        : `✓ داده‌ها با موفقیت از مخزن بازخوانی شدند (${fa(reloadRes.count)} محصول).`,
      'good',
    );
  } else {
    toast(`خطا در بازخوانی داده‌ها: ${reloadRes.error}`, 'bad');
  }
}

/* ---------- رویدادها ---------- */

function bindEvents() {
  // جست‌وجوی سراسری
  const search = $('#global-search');
  search.addEventListener(
    'input',
    debounce((e) => {
      setFilter('query', e.target.value);
    }, 220),
  );

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
      case 'close-drawer':
        closeDrawer();
        break;
      case 'clear-compare':
        store.compare.clear();
        saveCompare();
        renderSoon();
        toast('فهرست مقایسه پاک شد.');
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
      default:
        break;
    }
  });

  // کلیدها
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drawer().classList.contains('is-open')) closeDrawer();
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

    renderHero();
    render();
    renderFooter();
    bindEvents();

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

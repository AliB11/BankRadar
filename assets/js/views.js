/**
 * لایه نمایش: تبدیل وضعیت به HTML.
 *
 * همه مقادیر متنی از esc() عبور می‌کنند. هیچ رویداد درون‌خطی (onclick) وجود
 * ندارد؛ تعامل با data-action و delegation در app.js مدیریت می‌شود.
 */

import {
  esc, fa, faNum, faToman, faPercent, faSignedPercent, faDate, faAgo, freshness, safeUrl, daysSince,
} from './util.js';
import {
  CATEGORY_META, store, scoreOf, resultOf, summary, availableBanks, availableBanksIn, PRESETS,
  CONTRACT_META, CONTRACT_KEYS, isCreditCategory, contractCounts,
} from './store.js';
import { scoreTone, explainScore, WEIGHT_META, WEIGHT_KEYS, mostRecent } from './score.js';
import { scoreRing, donut, rateLadder, compareBars, freshnessGrid } from './charts.js';
import { loanSummary, realRate, scheduleFor, installmentInflationTrajectory } from './finance.js';

const confChip = {
  high: ['chip chip--good', 'منبع تأییدشده'],
  medium: ['chip', 'نیازمند تأیید نهایی'],
  low: ['chip chip--warn', 'اطمینان پایین'],
};

const collateralLabel = {
  none: 'بدون وثیقه',
  'credit-score': 'اعتبارسنجی',
  guarantor: 'ضامن',
  'deposit-block': 'سپرده مسدود',
  collateral: 'وثیقه ملکی',
  promissory: 'سفته',
  mixed: 'ترکیبی',
};

/* ---------- بخش قهرمان ---------- */

export function heroHTML() {
  const s = summary();
  const ind = store.indicators ?? {};
  const inflation = ind.inflationAnnual?.value ?? null;
  const depositCap = ind.depositCap1y?.value ?? null;
  const interbank = ind.interbankRate?.value ?? null;
  const loanCap = ind.loanRateCeiling?.value ?? null;

  const real = depositCap != null && inflation != null ? realRate(depositCap, inflation) : null;

  const macroCell = (label, value, tone = '') => `
    <div class="macro-cell">
      <span class="k">${esc(label)}</span>
      <span class="v num" ${tone ? `style="color:${tone}"` : ''}>${value}</span>
    </div>`;

  const healthTone = s.health >= 70 ? '' : s.health >= 45 ? 'progress--warn' : 'progress--bad';

  return `
  <section class="hero panel" aria-labelledby="hero-title">
    <div>
      <span class="pill-live"><span class="live-dot"></span> پایش زنده محصولات بانکی · ${esc(store.period || 'دوره جاری')}</span>
      <h1 id="hero-title">رادار محصولات بانکی ایران</h1>
      <p class="hero-lead">
        ${fa(s.total)} محصول مالی از ${fa(s.banks)} بانک و مؤسسه اعتباری، با امتیازدهی شفاف از دید مشتری.
        نرخ‌ها با تورم سنجیده می‌شوند تا «بازده حقیقی» — نه فقط عدد اسمی — در تصمیم دیده شود.
        داده‌ها از منابع رسمی بانک‌ها، بانک مرکزی و مراجع مقایسه‌ای گردآوری و به‌صورت خودکار به‌روزرسانی می‌شوند.
      </p>

      <div class="macro-strip">
        ${macroCell('تورم سالانه', inflation != null ? faPercent(inflation) : '—', 'var(--danger)')}
        ${macroCell('سقف سود سپرده', depositCap != null ? faPercent(depositCap) : '—')}
        ${macroCell('نرخ بین‌بانکی', interbank != null ? faPercent(interbank) : '—')}
        ${macroCell('سقف سود تسهیلات', loanCap != null ? faPercent(loanCap) : '—')}
      </div>

      ${
        real != null
          ? `<div class="real-rate-callout">
              <span class="ic" aria-hidden="true">⚠️</span>
              <div>
                <b>بازده حقیقی سپرده یک‌ساله: ${faSignedPercent(real)}</b>
                <p>
                  با تورم ${faPercent(inflation)} و سود اسمی ${faPercent(depositCap)}، نگهداری پول در سپرده یک‌ساله
                  قدرت خرید را کاهش می‌دهد. در امتیازدهی این سامانه، این فرسایش به‌صورت جریمه روی محصولات
                  منابعی اعمال می‌شود؛ به همین دلیل سپرده با نرخ ۲۳ درصد امتیاز بالایی نمی‌گیرد.
                </p>
              </div>
            </div>`
          : ''
      }
    </div>

    <aside class="panel" style="padding:var(--sp-5);display:grid;gap:var(--sp-4);align-content:start">
      <div class="row row-between">
        <strong style="font-size:var(--fs-sm)">سلامت مجموعه داده</strong>
        <span class="chip ${s.health >= 70 ? 'chip--good' : s.health >= 45 ? 'chip--warn' : 'chip--bad'}">
          ${fa(s.health)} از ۱۰۰
        </span>
      </div>
      <div class="progress ${healthTone}"><i style="width:${s.health}%"></i></div>

      <div class="health-list">
        <div class="health-row"><span class="lbl">محصول فعال</span><span class="val num">${fa(s.total)}</span></div>
        <div class="health-row" title="رکوردهایی که خط لوله در ۳۰ روز گذشته بازبینی کرده است">
          <span class="lbl">بازبینی‌شده در ۳۰ روز</span><span class="val num">${fa(s.verified30)}<small>از ${fa(s.total)}</small></span>
        </div>
        <div class="health-row" title="رکوردهایی که خود منبع در ۳۰ روز گذشته به‌روز کرده است">
          <span class="lbl">منبع به‌روز در ۳۰ روز</span><span class="val num">${fa(s.sourceFresh30)}<small>از ${fa(s.total)}</small></span>
        </div>
        <div class="health-row"><span class="lbl">منبع با اطمینان بالا</span><span class="val num">${fa(s.confidence.high)}<small>رکورد</small></span></div>
        <div class="health-row"><span class="lbl">گردآوری خودکار</span><span class="val num">${fa(s.auto)}<small>رکورد</small></span></div>
        <div class="health-row"><span class="lbl">میانگین جذابیت</span><span class="val num">${fa(s.avgScore)}<small>از ۱۰۰</small></span></div>
      </div>

      <div>
        <span class="eyebrow">تازگی داده در ۱۲ ماه گذشته</span>
        <div style="margin-block-start:var(--sp-3)">
          ${freshnessGrid(store.products.map((p) => p.lastUpdated).filter(Boolean), 12)}
        </div>
      </div>
    </aside>
  </section>`;
}

/* ---------- فیلترها ---------- */

/**
 * ساخت یک گزینه <option>.
 *
 * مقایسه به‌صورت رشته‌ای انجام می‌شود: مقدار گزینه در HTML همیشه رشته است، ولی
 * مقدار ذخیره‌شده در وضعیت می‌تواند عدد باشد (مثل f.minScore که با
 * Number(value) نگه داده می‌شود). با مقایسه دقیقِ `'65' === 65` گزینه انتخابی
 * کاربر پس از بازخوانی صفحه علامت‌گذاری نمی‌شد؛ یعنی فیلتر اعمال بود ولی
 * فهرست «نمایش همه» را نشان می‌داد.
 */
function option(value, label, selected) {
  const isSelected = String(value) === String(selected ?? '');
  return `<option value="${esc(value)}"${isSelected ? ' selected' : ''}>${esc(label)}</option>`;
}

export function filtersHTML() {
  const f = store.filters;
  const banks = availableBanksIn(f.category);
  const s = summary();
  // «نوع عقد» فقط برای محصولات اعتباری معنا دارد؛ در دسته‌های دیگر مخفی می‌ماند.
  const contracts = isCreditCategory(f.category) ? contractCounts(f.category) : null;

  const weightRow = (key) => {
    const meta = WEIGHT_META[key];
    return `<div class="weight">
      <div class="weight-head">
        <span title="${esc(meta.hint)}">${esc(meta.label)}</span>
        <b data-weight-value="${key}">${fa(store.weights[key])}</b>
      </div>
      <input type="range" min="${meta.min}" max="${meta.max}" step="1"
        value="${store.weights[key]}" data-weight="${key}"
        aria-label="وزن ${esc(meta.label)}" />
    </div>`;
  };

  return `
  <aside class="filters panel" aria-label="فیلتر و وزن‌دهی">
    <div class="filter-group">
      <div class="filter-legend">
        <span>جست‌وجو و پالایش</span>
        <button class="reset" type="button" data-action="reset-filters">پاک‌کردن</button>
      </div>

      <label class="field">
        <span class="field-label">بانک / مؤسسه</span>
        <select data-filter="bank">
          ${option('all', `همه (${fa(banks.length)} مورد)`, f.bank)}
          ${banks.map((b) => option(b, b, f.bank)).join('')}
        </select>
      </label>

      <label class="field">
        <span class="field-label">حداقل امتیاز جذابیت</span>
        <select data-filter="minScore">
          ${option('0', 'نمایش همه', f.minScore)}
          ${option('50', '۵۰ و بالاتر', f.minScore)}
          ${option('65', '۶۵ و بالاتر', f.minScore)}
          ${option('75', '۷۵ و بالاتر', f.minScore)}
          ${option('85', '۸۵ و بالاتر', f.minScore)}
        </select>
      </label>

      <label class="field">
        <span class="field-label">کانال دسترسی</span>
        <select data-filter="channel">
          ${option('all', 'همه کانال‌ها', f.channel)}
          ${option('online', 'عمدتاً غیرحضوری (امتیاز دیجیتال ۷۵+)', f.channel)}
          ${option('branch', 'نیازمند مراجعه شعبه', f.channel)}
        </select>
      </label>

      <label class="field">
        <span class="field-label">وضعیت وثیقه</span>
        <select data-filter="collateral">
          ${option('all', 'همه', f.collateral)}
          ${option('none', 'بدون وثیقه یا فقط اعتبارسنجی', f.collateral)}
          ${option('no-guarantor', 'بدون ضامن', f.collateral)}
        </select>
      </label>

      ${
        contracts
          ? `<label class="field">
        <span class="field-label">نوع عقد</span>
        <select data-filter="contract">
          ${option('all', `همه عقود (${fa(contracts.all)})`, f.contract)}
          ${CONTRACT_KEYS
            .map((k) => option(k, `${CONTRACT_META[k].label} (${fa(contracts[k] ?? 0)})`, f.contract))
            .join('')}
        </select>
      </label>`
          : ''
      }

      <label class="field">
        <span class="field-label">سطح اطمینان داده</span>
        <select data-filter="confidence">
          ${option('all', 'همه سطوح', f.confidence)}
          ${option('high', `تأییدشده (${fa(s.confidence.high)})`, f.confidence)}
          ${option('medium', `متوسط (${fa(s.confidence.medium)})`, f.confidence)}
          ${option('low', `پایین (${fa(s.confidence.low)})`, f.confidence)}
        </select>
      </label>

      <div style="margin-block-start:var(--sp-3)">
        <label class="check">
          <input type="checkbox" data-filter="onlyFresh" ${f.onlyFresh ? 'checked' : ''} />
          <span>فقط رکوردهای کنترل‌شده در ۶۰ روز اخیر</span>
        </label>
        <label class="check">
          <input type="checkbox" data-filter="onlyStale" ${f.onlyStale ? 'checked' : ''} />
          <span>فقط رکوردهای نیازمند بازبینی</span>
        </label>
      </div>
    </div>

    <div class="filter-group">
      <div class="filter-legend">
        <span>وزن‌های امتیازدهی</span>
        <button class="reset" type="button" data-action="reset-weights">بازنشانی</button>
      </div>

      <div class="seg" role="group" aria-label="پروفایل وزن‌دهی" style="margin-block-end:var(--sp-4);width:100%">
        ${Object.entries(PRESETS)
          .map(
            ([key, p]) =>
              `<button type="button" data-action="preset" data-key="${esc(key)}"
                aria-pressed="${store.activePreset === key}">${esc(p.label)}</button>`,
          )
          .join('')}
      </div>

      ${WEIGHT_KEYS.map(weightRow).join('')}

      <p style="font-size:var(--fs-3xs);color:var(--text-4);line-height:1.9;margin-block-start:var(--sp-2)">
        وزن‌ها بلافاصله روی رتبه‌بندی اثر می‌گذارند. برای دیدن اثر هر بعد، یک وزن را تا انتها ببرید.
      </p>
    </div>
  </aside>`;
}

export function tabsHTML() {
  const s = summary();
  return Object.entries(CATEGORY_META)
    .map(
      ([key, meta]) => `
    <button class="cat-tab" role="tab" data-action="category" data-key="${esc(key)}"
      aria-selected="${store.filters.category === key}"
      style="--tab-color:${esc(meta.color)}">
      <span class="ic" aria-hidden="true">${meta.icon}</span>
      <span>
        <span class="tt">${esc(meta.title)}</span>
        <span class="ct">${fa(s.byCategory[key] ?? 0)} محصول</span>
      </span>
    </button>`,
    )
    .join('');
}

const SORT_LABELS = {
  score: 'بیشترین جذابیت',
  rate: 'بالاترین نرخ',
  fresh: 'تازه‌ترین کنترل',
  speed: 'سریع‌ترین دسترسی',
  digital: 'کاملاً دیجیتال',
  ceiling: 'بیشترین سقف',
  name: 'ترتیب بانک',
};

export function toolbarHTML(rows) {
  return `
  <div class="toolbar panel">
    <span class="count">نمایش <b>${fa(rows.length)}</b> از ${fa(store.products.filter((p) => p.category === store.filters.category).length)} محصول این دسته</span>
    <div class="toolbar-spacer"></div>

    <label class="row" style="gap:var(--sp-2)">
      <span class="field-label" style="margin:0">مرتب‌سازی</span>
      <select data-filter="sort" style="width:auto;min-width:180px">
        ${Object.entries(SORT_LABELS).map(([v, l]) => option(v, l, store.filters.sort)).join('')}
      </select>
    </label>

    <button class="btn btn--sm" type="button" data-action="scroll-compare">
      مقایسه <span class="chip chip--info" style="margin-inline-start:4px">${fa(store.compare.size)}</span>
    </button>
    <button class="btn btn--sm" type="button" data-action="open-data">مرکز داده</button>
    <button class="btn btn--sm" type="button" data-action="open-method">روش امتیازدهی</button>
  </div>`;
}

/* ---------- کارت محصول ---------- */

function scoreChip(score) {
  const tone = scoreTone(score);
  return `<span class="chip" style="background:${tone.color}22;border-color:${tone.color}55;color:${tone.color}">${esc(tone.label)}</span>`;
}

/**
 * نشان متنی بانک برای کارت.
 *
 * برداشتن دو حرف نخست نام، برای نام‌هایی مثل «بانک قرض‌الحسنه رسالت» نتیجه
 * بی‌معنای «قر» می‌دهد. ابتدا واژه‌های عام (بانک، مؤسسه، قرض‌الحسنه، اعتباری)
 * حذف می‌شوند تا نشان از نام متمایزکننده ساخته شود.
 */
const GENERIC_BANK_WORDS = /^(بانک|مؤسسه|موسسه|قرض‌الحسنه|قرض الحسنه|اعتباری|غیربانکی|ایران|جمهوری|اسلامی)$/;

export function bankMonogram(name) {
  const words = String(name)
    .replace(/[()،,؛;]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^بانک$/, '').trim())
    .filter(Boolean)
    .filter((w) => !GENERIC_BANK_WORDS.test(w));

  // دو حرف نخست نخستین واژه متمایزکننده. تکرارپذیر و پایدار است:
  // «بانک رفاه کارگران» → «رف» و «بانک قرض‌الحسنه رسالت» → «رس».
  const primary = (words.length ? words : [String(name)])[0];
  return primary.slice(0, 2);
}

/**
 * معنای «نرخ حقیقی» در دسته‌های مختلف یکی نیست و برچسب یکسان، کاربر را
 * گمراه می‌کند:
 *   • سپرده — عدد منفی یعنی قدرت خرید از دست می‌رود (خبر بد).
 *   • تسهیلات — عدد منفی یعنی هزینه واقعی استقراض کمتر از تورم است (خبر خوب).
 * بنابراین برچسب و رنگ باید بر پایه دسته تعیین شود، نه بر پایه علامت عدد.
 */
export function realLabel(product) {
  return product.category === 'deposits' || product.category === 'funds' ? 'بازده حقیقی' : 'هزینه حقیقی';
}

export function realTitle(product) {
  return product.category === 'deposits' || product.category === 'funds'
    ? 'بازده حقیقی پس از کسر تورم — عدد منفی یعنی قدرت خرید کاهش می‌یابد'
    : 'هزینه حقیقی استقراض پس از کسر تورم — عدد منفی به سود وام‌گیرنده است';
}

export function realTone(product, real) {
  if (real == null) return 'chip';
  const good = product.category === 'deposits' || product.category === 'funds' ? real > 0 : real < 0;
  return good ? 'chip--good' : 'chip--bad';
}

export function cardHTML(p) {
  const result = resultOf(p.id);
  const score = result.score;
  const tone = scoreTone(score);
  const meta = CATEGORY_META[p.category];
  // ملاک تازگی با موتور امتیازدهی یکی است: جدیدترین تاریخ بازبینی خط لوله یا
  // به‌روزرسانی منبع (mostRecent). پیش‌تر فقط lastUpdated ملاک رنگ نشانگر بود و
  // رکورد «دیروز بازبینی‌شده با منبع کهنه» به‌اشتباه قرمز نشان داده می‌شد.
  const checked = mostRecent(p.lastUpdated, p.lastSeen);
  const fresh = freshness(checked);
  const compared = store.compare.has(p.id);
  const initials = bankMonogram(p.bank);

  const rateDisplay =
    p.rateKind === 'none' || p.rate === 0 ? '—' : faPercent(p.rate);

  const real =
    result.realRate != null
      ? `<span class="chip ${realTone(p, result.realRate)}" title="${realTitle(p)}">
           ${realLabel(p)} ${faSignedPercent(result.realRate)}</span>`
      : '';

  // نشان نوع عقد فقط برای محصولات اعتباری. برچسب‌ها از ثابت‌های داخلی
  // (CONTRACT_META) می‌آیند، نه از داده — بنابراین جای امن‌اند.
  const contractChip = isCreditCategory(p.category)
    ? `<span class="chip" style="padding:1px 8px">${esc(CONTRACT_META[p.contractType]?.short ?? 'نامشخص')}</span>`
    : '';

  return `
  <article class="card ${compared ? 'is-compared' : ''} ${p.stale ? 'is-stale' : ''}"
    style="--card-accent:${meta.color}22" data-card="${esc(p.id)}">
    <header class="card-head">
      <span class="card-logo" aria-hidden="true">${esc(initials)}</span>
      <div class="card-title">
        <h3>${esc(p.product)}</h3>
        <div class="bank">
          <span>${esc(p.bank)}</span>
          <span class="chip chip--cat-${esc(p.category)}" style="padding:1px 7px">${esc(meta.short)}</span>
          ${p.regulatory ? '<span class="chip chip--info" style="padding:1px 7px">مصوب</span>' : ''}
          ${p.stale ? '<span class="chip chip--warn" style="padding:1px 7px">نیازمند بازبینی</span>' : ''}
        </div>
      </div>
      <div class="score-ring" title="${esc(tone.label)} — امتیاز ${fa(score)} از ۱۰۰">
        ${scoreRing(score, tone.color, { size: 62 })}
        <span class="txt"><b class="num" style="color:${tone.color}">${fa(score)}</b><span>جذابیت</span></span>
      </div>
    </header>

    <div class="metrics">
      <div class="metric">
        <span class="k">${p.category === 'deposits' || p.category === 'funds' ? 'نرخ سود' : 'نرخ / کارمزد'}</span>
        <span class="v num">${rateDisplay}</span>
      </div>
      <div class="metric">
        <span class="k">سقف / دامنه</span>
        <span class="v">${esc(fa(p.amountLabel || faToman(p.maxAmount) || 'نامشخص'))}</span>
      </div>
      <div class="metric">
        <span class="k">مدت</span>
        <span class="v">${esc(fa(p.termLabel || (p.termMonths ? `${fa(p.termMonths)} ماه` : 'نامشخص')))}</span>
      </div>
    </div>

    <p class="card-desc">${esc(p.desc)}</p>

    <div class="tags">
      <span class="chip" style="padding:1px 8px">${esc(collateralLabel[p.collateralKind] ?? 'نامشخص')}</span>
      ${contractChip}
      ${real}
      ${(p.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
    </div>

    <footer class="card-foot">
      <span class="freshness ${fresh}">
        <span aria-hidden="true">●</span>
        ${(() => {
          // دو تاریخ متفاوت است: زمان بازبینی توسط خط لوله، و زمان
          // به‌روزرسانی خود منبع. نمایش هر دو، تصویر صادقانه‌تری می‌دهد.
          const srcDate = p.lastUpdated;
          const srcOld = srcDate && daysSince(srcDate) > 90;
          return `کنترل ${esc(faAgo(checked))}${srcOld ? ` · منبع: ${esc(faDate(srcDate))}` : ''}`;
        })()}
      </span>
      <span class="card-actions">
        <button class="btn btn--sm ${compared ? 'btn--primary' : ''}" type="button"
          data-action="toggle-compare" data-id="${esc(p.id)}">
          ${compared ? '✓ در مقایسه' : 'افزودن به مقایسه'}
        </button>
        <button class="btn btn--sm" type="button" data-action="detail" data-id="${esc(p.id)}">جزئیات</button>
      </span>
    </footer>
  </article>`;
}


export function cardsHTML(rows) {
  if (!rows.length) return emptyHTML();
  return rows.map(cardHTML).join('');
}

function emptyHTML() {
  return `
  <div class="empty-state">
    <span class="ic" aria-hidden="true">🔍</span>
    <h3>محصولی با این فیلترها پیدا نشد</h3>
    <p>محدوده فیلترها را گسترده‌تر کنید، یا دسته دیگری را انتخاب کنید. اگر به‌تازگی داده‌ای وارد کرده‌اید، مطمئن شوید دسته‌بندی آن با دسته فعال هم‌خوان است.</p>
    <button class="btn btn--sm" type="button" data-action="reset-filters">پاک‌کردن فیلترها</button>
  </div>`;
}

/* ---------- رتبه‌بندی ---------- */

export function rankHTML(rows) {
  const top = rows.slice(0, 8);
  const meta = CATEGORY_META[store.filters.category];

  if (!top.length) {
    return `<div class="panel panel-pad" style="margin-block-start:var(--sp-5)">
      <div class="section-title" style="margin-block-start:0">رتبه‌بندی جذابیت — ${esc(meta.title)}</div>
      <p style="font-size:var(--fs-xs);color:var(--text-3)">برای این فیلترها محصولی برای رتبه‌بندی وجود ندارد.</p>
    </div>`;
  }

  return `
  <section class="panel panel-pad" style="margin-block-start:var(--sp-5)" aria-label="رتبه‌بندی جذابیت">
    <div class="row row-between" style="margin-block-end:var(--sp-4)">
      <div>
        <h3 style="font-size:var(--fs-sm);margin:0">رتبه‌بندی جذابیت — ${esc(meta.title)}</h3>
        <p style="font-size:var(--fs-3xs);color:var(--text-4);margin:2px 0 0">
          بر پایه وزن‌های جاری شما و با تعدیل نرخ حقیقی · ${esc(meta.desc)}
        </p>
      </div>
      <span class="chip">${fa(rows.length)} محصول در رتبه‌بندی</span>
    </div>

    <div class="rank-list">
      ${top
        .map((p, i) => {
          const result = resultOf(p.id);
          return `<div class="rank-item">
            <span class="pos num">${fa(i + 1)}</span>
            <div class="body">
              <div class="top">
                <span class="nm">${esc(p.bank)} — ${esc(p.product)}</span>
                <span class="sc num">${fa(result.score)}</span>
              </div>
              <div class="bar"><i style="width:${result.score}%"></i></div>
            </div>
            <button class="btn btn--sm" type="button" data-action="detail" data-id="${esc(p.id)}">جزئیات</button>
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

/* ---------- جدول مقایسه ---------- */

/** آیا برای این محصول می‌توان قسط در سقف مجاز را معنا کرد؟ */
function isFinanced(p) {
  return (p.category === 'loans' || p.category === 'credit') && p.maxAmount && p.termMonths;
}

/** آیا سقف این محصول مشروط است (نه یک حق قطعی)؟ */
export function isContingent(p) {
  return p?.ceilingContingent === true;
}

export function compareHTML() {
  const items = store.products.filter((p) => store.compare.has(p.id));

  if (!items.length) {
    return `<section class="panel panel-pad" style="margin-block-start:var(--sp-5)" id="compare-section">
      <div class="row row-between">
        <h3 style="font-size:var(--fs-sm);margin:0">جدول مقایسه</h3>
      </div>
      <p style="font-size:var(--fs-xs);color:var(--text-3);margin-block-start:var(--sp-2)">
        هنوز محصولی برای مقایسه انتخاب نشده است. از دکمه «افزودن به مقایسه» روی کارت‌ها استفاده کنید؛
        می‌توانید محصولات دسته‌های مختلف را با هم بسنجید.
      </p>
    </section>`;
  }

  const inflation = store.indicators?.inflationAnnual?.value ?? null;

  // محاسبه بهترین مقدار هر ردیف برای برجسته‌سازی
  const rows = [
    { key: 'score', label: 'امتیاز جذابیت', get: (p) => scoreOf(p.id), lowerIsBetter: false, fmt: (v) => fa(v) },
    { key: 'real', label: 'بازده/هزینه حقیقی', get: (p) => resultOf(p.id).realRate, lowerIsBetter: false, fmt: (v) => (v == null ? '—' : faSignedPercent(v)) },
    { key: 'rate', label: 'نرخ / کارمزد سالانه', get: (p) => (p.rateKind === 'none' ? null : p.rate), lowerIsBetter: true, fmt: (v) => faPercent(v) },
    { key: 'max', label: 'سقف مبلغ', contingent: true, get: (p) => p.maxAmount, lowerIsBetter: false, fmt: (v) => (v == null ? '—' : faToman(v)) },
    { key: 'min', label: 'حداقل مبلغ', get: (p) => p.minAmount, lowerIsBetter: true, fmt: (v) => faToman(v) },
    { key: 'term', label: 'مدت بازپرداخت', get: (p) => p.termMonths, lowerIsBetter: false, fmt: (v) => (v ? `${fa(v)} ماه` : '—') },
    { key: 'installment', label: 'قسط تقریبی (در سقف مجاز)', contingent: true, get: (p) => (isFinanced(p) ? scheduleFor(p, p.maxAmount, p.termMonths).installment : null), lowerIsBetter: true, fmt: (v) => faToman(v) },
    { key: 'interest', label: 'کل هزینه مالی (سود یا کارمزد)', contingent: true, get: (p) => (isFinanced(p) ? scheduleFor(p, p.maxAmount, p.termMonths).totalInterest : null), lowerIsBetter: true, fmt: (v) => faToman(v) },
    { key: 'collateral', label: 'وثیقه / ضمانت', get: (p) => null, lowerIsBetter: false, fmt: (_, p) => esc(fa(p.collateral)) },
    { key: 'digital', label: 'امتیاز دیجیتال', get: (p) => p.digital, lowerIsBetter: false, fmt: (v) => fa(Math.round(v)) },
    { key: 'friction', label: 'کمبود اصطکاک', get: (p) => p.friction, lowerIsBetter: false, fmt: (v) => fa(Math.round(v)) },
    { key: 'fresh', label: 'آخرین کنترل خط لوله', get: (p) => null, lowerIsBetter: false, fmt: (_, p) => (p.lastSeen || p.lastUpdated ? esc(faDate(p.lastSeen || p.lastUpdated)) : '—') },
    { key: 'srcFresh', label: 'به‌روزرسانی منبع', get: (p) => null, lowerIsBetter: false, fmt: (_, p) => (p.lastUpdated ? esc(faDate(p.lastUpdated)) : '—') },
    { key: 'conf', label: 'اطمینان منبع', get: (p) => null, lowerIsBetter: false, fmt: (_, p) => esc((confChip[p.confidence] ?? confChip.medium)[1]) },
  ];

  // انتخاب «مقدار برتر» هر ردیف.
  //
  // در ردیف‌های وابسته به سقف (قسط، سقف مبلغ، کل هزینه مالی)، محصولی که سقفش
  // مشروط به سپرده یا امتیاز است کنار گذاشته می‌شود؛ در غیر این صورت محصولی با
  // سقف ۴ میلیاردیِ فرضی، برنده «کم‌ترین قسط» می‌شود و مقایسه بی‌معنا می‌گردد.
  const bestByRow = new Map();
  for (const row of rows) {
    const eligible = row.contingent ? items.filter((p) => !p.ceilingContingent) : items;
    const values = eligible.map((p) => row.get(p)).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) continue;
    const best = row.lowerIsBetter ? Math.min(...values) : Math.max(...values);
    bestByRow.set(row.key, best);
  }

  return `
  <section class="panel panel-pad" style="margin-block-start:var(--sp-5)" id="compare-section" aria-label="جدول مقایسه">
    <div class="row row-between" style="margin-block-end:var(--sp-4)">
      <div>
        <h3 style="font-size:var(--fs-sm);margin:0">جدول مقایسه انتخابی</h3>
        <p style="font-size:var(--fs-3xs);color:var(--text-4);margin:2px 0 0">
          ${fa(items.length)} محصول · مقادیر برتر هر ردیف با رنگ سبز مشخص شده‌اند${inflation != null ? ` · نرخ حقیقی با تورم ${faPercent(inflation)} محاسبه شده` : ''}
          ${items.some((p) => p.ceilingContingent) ? '<br>≈ سقف مشروط به سپرده، امتیاز یا مصوبه اعتباری — محاسبه در این سقف فرضی است و در انتخاب مقدار برتر لحاظ نشده' : ''}
        </p>
      </div>
      <div class="row" style="gap:var(--sp-2)">
        <button class="btn btn--sm" type="button" data-action="download-csv">خروجی CSV</button>
        <button class="btn btn--sm btn--danger" type="button" data-action="clear-compare">پاک‌کردن</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="compare">
        <thead>
          <tr>
            <th scope="col">معیار</th>
            ${items.map((p) => `<th scope="col">
              <span class="prod-name">${esc(p.product)}</span><br>
              <span class="prod-bank">${esc(p.bank)}</span>
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const best = bestByRow.get(row.key);
              return `<tr>
                <th scope="row">${esc(row.label)}</th>
                ${items
                  .map((p) => {
                    const v = row.get(p);
                    const hypothetical = row.contingent && p.ceilingContingent && v != null;
                    const isBest =
                      !hypothetical &&
                      typeof v === 'number' && Number.isFinite(v) &&
                      best != null && v === best && items.length > 1;

                    const content = row.fmt(v, p);
                    const cell = hypothetical
                      ? `<span title="سقف این محصول مشروط به سپرده، امتیاز یا مصوبه اعتباری است؛ مبلغ واقعی ممکن است کمتر باشد">≈ ${content}</span>`
                      : content;
                    return `<td class="${isBest ? 'best' : ''}${hypothetical ? ' estimated' : ''}">${cell}</td>`;
                  })
                  .join('')}
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

/* ---------- نمودارها ---------- */

export function chartsHTML(rows) {
  const s = summary();
  const inflation = store.indicators?.inflationAnnual?.value ?? null;

  const slices = Object.entries(CATEGORY_META).map(([key, meta]) => ({
    label: meta.title,
    value: s.byCategory[key] ?? 0,
    color: meta.color,
  }));

  const ladderRows = (store.ranges?.depositCaps ?? []).map((r) => ({
    label: r.label,
    rate: r.rate,
    note: r.note,
    negative: r.rate < (inflation ?? 0),
  }));

  const loanRows = (store.ranges?.loanCaps ?? []).map((r) => ({
    label: r.label,
    rate: r.rate,
    note: r.note,
  }));

  const topByBenefit = [...rows]
    .sort((a, b) => b.benefit - a.benefit)
    .slice(0, 6)
    .map((p) => ({
      label: `${p.bank.replace(/^بانک\s*/, '')} — ${p.product.slice(0, 26)}`,
      value: Math.round(p.benefit),
      color: CATEGORY_META[p.category].color,
    }));

  return `
  <section class="chart-grid" style="margin-block-start:var(--sp-5)">
    <div class="panel chart-card">
      <div class="chart-head">
        <div>
          <h3>نردبان نرخ سود در برابر تورم</h3>
          <p>مقایسه سقف‌های مصوب سپرده با تورم سالانه — نرخ‌های زیر خط تورم، بازده حقیقی منفی دارند</p>
        </div>
      </div>
      ${rateLadder(ladderRows, inflation)}
    </div>

    <div class="panel chart-card">
      <div class="chart-head">
        <div>
          <h3>نرخ تسهیلات و کارمزد قرض‌الحسنه</h3>
          <p>سقف‌های مصوب شورای پول و اعتبار برای انواع عقود</p>
        </div>
      </div>
      ${rateLadder(loanRows, inflation)}
    </div>

    <div class="panel chart-card">
      <div class="chart-head">
        <div>
          <h3>پوشش دسته‌ها</h3>
          <p>توزیع ${fa(s.total)} محصول ثبت‌شده در پنج دسته اصلی</p>
        </div>
      </div>
      <div class="donut-wrap">
        <div class="donut">
          ${donut(slices, { size: 160 })}
          <div class="center">
            <b class="num">${fa(s.total)}</b>
            <span>محصول</span>
          </div>
        </div>
        <div class="legend">
          ${slices
            .map(
              (sl) => `<div class="legend-row">
                <span class="swatch" style="background:${sl.color}"></span>
                <span>${esc(sl.label)}</span>
                <span class="n">${fa(sl.value)}</span>
              </div>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="panel chart-card">
      <div class="chart-head">
        <div>
          <h3>بالاترین مزیت مالی در این دسته</h3>
          <p>امتیاز خام مزیت (پیش از اعمال وزن‌های شما)</p>
        </div>
      </div>
      ${compareBars(topByBenefit, { max: 100 })}
    </div>
  </section>`;
}

/* ---------- کشو جزئیات ---------- */

export function detailHTML(p) {
  if (!p) return '';
  const result = resultOf(p.id);
  const tone = scoreTone(result.score);
  const meta = CATEGORY_META[p.category];
  const inflation = store.indicators?.inflationAnnual?.value ?? null;
  const isLoan = p.category === 'loans' || p.category === 'credit';
  // همان ملاک موتور امتیازدهی و کارت: جدیدترین تاریخ بازبینی یا به‌روزرسانی منبع
  const checked = mostRecent(p.lastUpdated, p.lastSeen);

  const spec = (k, v) => `<div class="spec"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;

  const isFee = p.rateKind === 'fee';
  const summaryFinance = isLoan && p.maxAmount ? loanSummary(p, { inflation }) : null;

  const calcSection =
    isLoan && p.maxAmount
      ? `
    <div class="section-title">ماشین‌حساب اقساط</div>
    <div class="calc" data-calc data-id="${esc(p.id)}"
      data-max="${p.maxAmount || 0}" data-min="${p.minAmount || 0}"
      data-rate="${p.rate || 0}" data-term="${p.termMonths || 36}">
      <div class="row" style="gap:var(--sp-3)">
        <label class="field" style="flex:1;min-width:150px">
          <span class="field-label">مبلغ تسهیلات (میلیون تومان)</span>
          <input type="number" data-calc-input="amount" min="1" step="1"
            value="${Math.round((p.maxAmount || 100000000) / 1e6)}" />
        </label>
        <label class="field" style="flex:1;min-width:120px">
          <span class="field-label">تعداد اقساط (ماه)</span>
          <input type="number" data-calc-input="months" min="1" max="360" step="1"
            value="${p.termMonths || 36}" />
        </label>
        <label class="field" style="flex:1;min-width:120px">
          <span class="field-label">${p.rateKind === 'fee' ? 'کارمزد یک‌بار (٪)' : 'نرخ سود سالانه (٪)'}</span>
          <input type="number" data-calc-input="rate" min="0" max="60" step="0.1"
            value="${p.rate || 23}" />
        </label>
      </div>
      <div class="calc-out" data-calc-out></div>
      <div class="row" style="gap:var(--sp-2)">
        <button class="btn btn--sm" type="button" data-action="calc-reset">بازگشت به مقادیر محصول</button>
        <span style="font-size:var(--fs-3xs);color:var(--text-4)">
          ${p.rateKind === 'fee'
            ? 'کارمزد یک‌بار روی کل اصل بسته و به اقساط مساوی تقسیم می‌شود (روش قرض‌الحسنه)'
            : 'روش جدید = اقساط مساوی با نرخ مؤثر روی مانده · روش قدیمی = سود مازاد تقسیم‌شده'}
        </span>
      </div>
    </div>`
      : '';

  const depositSection =
    (p.category === 'deposits' || p.category === 'funds') && inflation != null && p.rate > 0
      ? `
    <div class="section-title">تحلیل بازده حقیقی</div>
    <div class="calc-out">
      <div><span class="k">نرخ اسمی</span><span class="v num">${faPercent(p.rate)}</span></div>
      <div><span class="k">تورم سالانه</span><span class="v num" style="color:var(--danger)">${faPercent(inflation)}</span></div>
      <div><span class="k">${realLabel(p)}</span><span class="v num" style="color:${result.realRate == null ? 'var(--text-3)' : realTone(p, result.realRate) === 'chip--good' ? 'var(--brand)' : 'var(--danger)'}">${result.realRate == null ? '—' : faSignedPercent(result.realRate)}</span></div>
      <div><span class="k">ارزش ۱۰۰ میلیون پس از یک سال</span><span class="v num">${faToman(Math.round(100_000_000 * ((1 + p.rate / 100) / (1 + inflation / 100))), { short: true })}</span></div>
    </div>
    <p style="font-size:var(--fs-3xs);color:var(--text-4);margin-block-start:var(--sp-2);line-height:1.9">
      محاسبه بر پایه رابطه فیشر: ارزش حقیقی = مبلغ اسمی × (۱ + نرخ) ÷ (۱ + تورم).
      اگر این عدد کمتر از ۱۰۰ میلیون تومان باشد، سپرده‌گذاری قدرت خرید را کاهش داده است.
    </p>`
      : '';

  const explain = explainScore(p, result, { inflation });

  return `
  <div class="drawer-head">
    <div style="flex:1;min-width:0">
      <div class="row" style="gap:var(--sp-2);margin-block-end:var(--sp-2)">
        <span class="chip chip--cat-${esc(p.category)}">${esc(meta.title)}</span>
        ${p.regulatory ? '<span class="chip chip--info">مصوب نهاد ناظر</span>' : ''}
        ${p.multiPlan ? '<span class="chip chip--warn" title="این صفحه بسته چند طرح مستقل است؛ سقف و مدت نوشته‌شده به یک محصول واحد تعلق ندارد">بسته چندطرحی</span>' : ''}
        ${p.autoDiscovered ? '<span class="chip">گردآوری خودکار</span>' : '<span class="chip chip--good">دستی‌گردآوری</span>'}
      </div>
      <h2>${esc(p.product)}</h2>
      <div style="font-size:var(--fs-2xs);color:var(--text-3);margin-block-start:3px">
        ${esc(fa(p.bank))}${p.audience ? ` · ${esc(fa(p.audience))}` : ''}
      </div>
    </div>
    <button class="btn btn--icon btn--ghost" type="button" data-action="close-drawer" aria-label="بستن">✕</button>
  </div>

  <div class="drawer-body">
    <div class="row row-between" style="margin-block-end:var(--sp-4)">
      <div class="score-ring" style="width:74px;height:74px">
        ${scoreRing(result.score, tone.color, { size: 74, stroke: 6 })}
        <span class="txt"><b class="num" style="color:${tone.color};font-size:var(--fs-xl)">${fa(result.score)}</b><span>جذابیت</span></span>
      </div>
      <div style="flex:1;text-align:end">
        ${scoreChip(result.score)}
        <div style="font-size:var(--fs-2xs);color:var(--text-4);margin-block-start:4px">
          ${checked ? `آخرین کنترل: ${esc(faDate(checked))} (${esc(faAgo(checked))})` : 'تاریخ کنترل نامشخص'}
          ${p.lastUpdated && p.lastUpdated !== checked ? ` · به‌روزرسانی منبع: ${esc(faDate(p.lastUpdated))}` : ''}
        </div>
      </div>
    </div>

    <div class="spec-grid">
      ${spec('نرخ / کارمزد', p.rateKind === 'none' ? 'غیرنرخ‌دار' : faPercent(p.rate))}
      ${spec('سقف مبلغ', esc(fa(p.amountLabel || faToman(p.maxAmount))))}
      ${p.multiPlan ? `<div><span class="k">توجه</span><span class="v" style="font-size:var(--fs-3xs);color:var(--text-3);line-height:1.9">این صفحه یک بسته چند طرح مستقل است؛ سقف و مدت بازپرداخت بین طرح‌ها متفاوت است و ارقام منفرد در جدول مقایسه آورده نمی‌شود.</span></div>` : ''}
      ${spec('حداقل مبلغ', esc(faToman(p.minAmount)))}
      ${spec('مدت', esc(fa(p.termLabel || (p.termMonths ? `${fa(p.termMonths)} ماه` : 'نامشخص'))))}
      ${isLoan ? spec('نوع عقد', `${esc(CONTRACT_META[p.contractType]?.label ?? 'نامشخص')}${CONTRACT_META[p.contractType]?.hint ? ` <span style="font-size:var(--fs-3xs);color:var(--text-4)">(${esc(CONTRACT_META[p.contractType].hint)})</span>` : ''}`) : ''}
      ${spec('وثیقه / ضمانت', esc(fa(p.collateral)))}
      ${spec('نوع وثیقه', esc(collateralLabel[p.collateralKind] ?? 'نامشخص'))}
      ${spec('سطح اطمینان', esc((confChip[p.confidence] ?? confChip.medium)[1]))}
      ${spec(realLabel(p), result.realRate != null ? faSignedPercent(result.realRate) : '—')}
    </div>

    ${calcSection}
    ${depositSection}

    <div class="section-title">توضیح محصول</div>
    <p style="font-size:var(--fs-xs);line-height:2.05;color:var(--text-2)">${esc(p.desc)}</p>

    ${
      p.requirements?.length
        ? `<div class="section-title">شرایط و مدارک</div>
           <ul class="req-list">${p.requirements.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
        : ''
    }

    ${
      p.tags?.length
        ? `<div class="section-title">برچسب‌ها</div>
           <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
        : ''
    }

    <div class="section-title">چرا این امتیاز؟</div>
    <ul class="req-list">${explain.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>

    <div class="section-title">تفکیک امتیاز</div>
    <div class="ladder">
      ${WEIGHT_KEYS.map((k) => {
        const v = Math.round(result.parts[k] ?? 0);
        return `<div class="ladder-row">
          <span class="lbl">${esc(WEIGHT_META[k].label)}</span>
          <span class="ladder-track"><i style="width:${v}%"></i></span>
          <span class="val">${fa(v)}</span>
        </div>`;
      }).join('')}
    </div>

    ${
      summaryFinance
        ? `<div class="section-title">تحلیل تسهیلات در سقف مجاز</div>
           <div class="calc-out">
             <div><span class="k">${isFee ? 'قسط ماهانه' : 'قسط (روش جدید)'}</span><span class="v num">${faToman(summaryFinance.standard.installment)}</span></div>
             ${isFee ? '' : `<div><span class="k">قسط (روش قدیمی)</span><span class="v num">${faToman(summaryFinance.legacy.installment)}</span></div>`}
             <div><span class="k">${isFee ? 'کل کارمزد' : 'کل سود'}</span><span class="v num">${faToman(summaryFinance.standard.totalInterest)}</span></div>
             <div><span class="k">نرخ مؤثر سالانه</span><span class="v num">${faPercent(summaryFinance.effective)}</span></div>
           </div>
           <p style="font-size:var(--fs-3xs);color:var(--text-4);margin-block-start:var(--sp-2);line-height:1.9">
             ${isFee
               ? `این محصول کارمزد‌محور است: ${faPercent(p.rate)} یک‌بار روی کل اصل بسته می‌شود و سود مرکبی وجود ندارد.
                  با تقسیم مبلغ بر تعداد اقساط، نرخ مؤثر سالانه تنها حدود ${faPercent(summaryFinance.effective)} می‌شود —
                  یعنی در تورم کنونی، ارزان‌ترین منبع تأمین مالی به‌شمار می‌آید.`
               : `تفاوت دو روش در این محصول ${faToman(summaryFinance.difference)} است.
                  نرخ مؤثر با احتساب کارمزد کسرشده از اصل محاسبه می‌شود و از نرخ اسمی بالاتر است.
                  توجه: این عدد هزینه‌های جانبی مانند بیمه، کارمزد ضامن و هزینه فرصت سپرده را در بر نمی‌گیرد،
                  بنابراین کف هزینه واقعی است نه سقف آن.`}
           </p>
           ${
             inflation != null && summaryFinance.standard.installment > 0
               ? (() => {
                   const trajectory = installmentInflationTrajectory(
                     summaryFinance.standard.installment,
                     summaryFinance.months,
                     inflation,
                   );
                   if (trajectory.length <= 1) return '';
                   return `
                     <div class="section-title">شبیه‌ساز ذوب تورمی اقساط (کاهش بار واقعی بدهی)</div>
                     <div class="spec-grid">
                       ${trajectory
                         .map(
                           (t) => `
                         <div class="spec">
                           <span class="k">سال ${fa(t.year)} (${fa(t.erosionPercent)}٪ افت بار قسط)</span>
                           <span class="v num" style="color:var(--brand)">${faToman(t.realPurchasingPower)}</span>
                         </div>`,
                         )
                         .join('')}
                     </div>
                     <p style="font-size:var(--fs-3xs);color:var(--text-4);margin-block-start:var(--sp-1);line-height:1.9">
                       با توجه به تورم سالانه ${faPercent(inflation)}، ارزش واقعی قسط اسمی ${faToman(summaryFinance.standard.installment)} به مرور زمان کاهش می‌یابد.
                       در سال ${fa(trajectory[trajectory.length - 1].year)}، ارزش قدرت خرید این قسط معادل تنها ${faToman(trajectory[trajectory.length - 1].realPurchasingPower)} خواهد بود (${fa(trajectory[trajectory.length - 1].erosionPercent)}٪ افت بار پرداخت به سود وام‌گیرنده).
                     </p>
                   `;
                 })()
               : ''
           }`
        : ''
    }
    ${
      p.collateralKind === 'deposit-block'
        ? `<div class="spec" style="border-color:var(--danger);background:rgba(255,107,129,0.08);margin-block:var(--sp-3)">
             <span class="k" style="color:var(--danger);font-weight:bold">⚠️ هشدار تله مسدودی سپرده</span>
             <span class="v" style="font-size:var(--fs-3xs);color:var(--text-2);line-height:1.9">
               این تسهیلات نیازمند مسدودسازی سپرده نزد بانک است. با توجه به تورم بالا و عدم پرداخت سود متناسب به سپرده مسدودی، هزینه فرصت خواب پول باعث می‌شود نرخ مؤثر واقعی این وام به مراتب از نرخ اسمی اعلامی بیشتر تمام شود.
             </span>
           </div>`
        : ''
    }
  </div>

  <div class="drawer-foot">
    ${
      p.source?.url
        ? `<a class="btn btn--sm" href="${safeUrl(p.source.url)}" target="_blank" rel="noopener noreferrer">
             مشاهده منبع: ${esc(p.source.title || 'لینک')}</a>`
        : ''
    }
    <button class="btn btn--sm ${store.compare.has(p.id) ? 'btn--primary' : ''}" type="button"
      data-action="toggle-compare" data-id="${esc(p.id)}">
      ${store.compare.has(p.id) ? '✓ در مقایسه' : 'افزودن به مقایسه'}
    </button>
  </div>`;
}

/* ---------- مرکز داده ---------- */

export function dataModalHTML() {
  const s = summary();
  const sources = store.meta?.sources ?? [];

  return `
  <div class="modal-head">
    <div>
      <h2>مرکز داده و منابع</h2>
      <p style="font-size:var(--fs-2xs);color:var(--text-4);margin:3px 0 0">
        وضعیت خط لوله گردآوری خودکار و امکان بارگذاری داده دستی
      </p>
    </div>
    <button class="btn btn--icon btn--ghost" type="button" data-action="close-data" aria-label="بستن">✕</button>
  </div>

  <div class="modal-body">
    <div class="spec-grid">
      <div class="spec"><span class="k">آخرین اجرای خط لوله</span><span class="v">${store.meta?.lastRun ? esc(faDate(String(store.meta.lastRun).slice(0, 10))) : 'نامشخص'}</span></div>
      <div class="spec"><span class="k">منبع بارگذاری</span><span class="v">${store.meta?.loadSource === 'json' ? 'JSON تازه' : 'بسته درون‌خطی'}</span></div>
      <div class="spec"><span class="k">مجموع محصولات</span><span class="v num">${fa(s.total)}</span></div>
      <div class="spec"><span class="k">گردآوری خودکار</span><span class="v num">${fa(s.auto)}</span></div>
    </div>

    <div class="section-title">وضعیت منابع در آخرین اجرا</div>
    ${
      sources.length
        ? `<div class="health-list">
            ${sources
              .map(
                (src) => `<div class="health-row">
                  <span class="lbl">${esc(src.name)}</span>
                  <span class="chip ${src.ok ? 'chip--good' : 'chip--bad'}">
                    ${src.ok ? 'موفق' : 'ناموفق'}
                    ${src.parsed != null ? ` · ${fa(src.parsed)} محصول` : ''}
                  </span>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p style="font-size:var(--fs-xs);color:var(--text-3)">
            اطلاعات اجرای خط لوله در این بارگذاری موجود نیست. پس از نخستین اجرای خودکار، وضعیت هر منبع اینجا نمایش داده می‌شود.
          </p>`
    }

    <div class="section-title">به‌روزرسانی و همگام‌سازی زنده</div>
    <div style="background:var(--surface-2);border:1px solid var(--hairline-strong);border-radius:var(--r-md);padding:var(--sp-3);margin-block-end:var(--sp-4)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:var(--fs-sm);color:var(--text-1);margin-block-end:2px">استعلام فوری و بازخوانی آخرین داده‌ها</div>
          <div style="font-size:var(--fs-2xs);color:var(--text-3);line-height:1.7">
            دریافت تازه‌ترین نرخ‌ها، محصولات جدید بانک‌ها، ممیزی ناهنجاری‌ها و بازسازی رتبه‌بندی.
          </div>
        </div>
        <button class="btn btn--primary btn--sm" type="button" data-action="sync-data-now">
          <span class="refresh-icon" aria-hidden="true">↻</span> استعلام و همگام‌سازی
        </button>
      </div>
    </div>

    <div class="section-title">سازوکار ممیزی هفتگی و درون‌ریزی داده</div>
    <div class="spec-grid" style="margin-block-end:var(--sp-3)">
      <div class="spec">
        <span class="k">پایش هفتگی خودکار</span>
        <span class="v" style="color:var(--brand)">فعال (زمان‌بندی دوره‌ای)</span>
      </div>
      <div class="spec">
        <span class="k">ممیزی رکوردهای پنج‌گانه</span>
        <span class="v">سپرده، صندوق، تسهیلات، کارت، امتیاز</span>
      </div>
      <div class="spec">
        <span class="k">فرمان همگام‌سازی هفتگی</span>
        <span class="v"><code>npm run sync:weekly</code></span>
      </div>
      <div class="spec">
        <span class="k">درون‌ریزی خروجی سفارشی</span>
        <span class="v"><code>sync:weekly --input=&lt;فایل&gt;</code></span>
      </div>
    </div>

    <div class="section-title">بارگذاری داده دستی</div>
    <p style="font-size:var(--fs-2xs);color:var(--text-3);line-height:1.95;margin-block-end:var(--sp-3)">
      می‌توانید یک آرایه JSON از محصولات را جای‌گذاری کنید. داده‌های بارگذاری‌شده فقط در همین مرورگر ذخیره می‌شوند
      و روی خط لوله خودکار اثری ندارند. برای اعمال دائمی، فایل <code>data/products.json</code> را در مخزن به‌روزرسانی کنید.
    </p>
    <textarea data-field="json-input" placeholder='[{"id":"example","bank":"بانک نمونه","product":"محصول نمونه","category":"loans","rate":23,"lastUpdated":"2026-09-15","source":{"title":"منبع","url":"https://example.com"}}]'></textarea>
    <div class="row" style="margin-block-start:var(--sp-3)">
      <button class="btn btn--primary btn--sm" type="button" data-action="import-json">بارگذاری JSON</button>
      <button class="btn btn--sm" type="button" data-action="download-json">خروجی JSON فعلی</button>
      <button class="btn btn--sm" type="button" data-action="download-csv">خروجی CSV</button>
      <button class="btn btn--sm btn--danger" type="button" data-action="reset-local">پاک‌کردن داده محلی</button>
    </div>
  </div>`;
}

/* ---------- روش امتیازدهی ---------- */

export function methodModalHTML() {
  const inflation = store.indicators?.inflationAnnual?.value ?? null;

  return `
  <div class="modal-head">
    <div>
      <h2>روش امتیازدهی</h2>
      <p style="font-size:var(--fs-2xs);color:var(--text-4);margin:3px 0 0">شفافیت کامل الگوریتم — بدون جعبه سیاه</p>
    </div>
    <button class="btn btn--icon btn--ghost" type="button" data-action="close-method" aria-label="بستن">✕</button>
  </div>

  <div class="modal-body">
    <p style="font-size:var(--fs-xs);line-height:2.05;color:var(--text-2)">
      امتیاز «جذابیت» یک عدد بین ۰ تا ۱۰۰ است که از دید مشتری محاسبه می‌شود، نه از دید بانک.
      این امتیاز از پنج بعد ساخته می‌شود که وزن هرکدام را خودتان تعیین می‌کنید:
    </p>

    <div class="section-title">ابعاد امتیاز</div>
    <div class="spec-grid">
      ${WEIGHT_KEYS.map((k) => {
        const m = WEIGHT_META[k];
        return `<div class="spec">
          <span class="k">${esc(m.label)} — بازه ${fa(m.min)} تا ${fa(m.max)}</span>
          <span class="v" style="font-weight:400">${esc(m.hint)}</span>
        </div>`;
      }).join('')}
    </div>

    <div class="section-title">سه اصلاحی که امتیاز را واقع‌گرا می‌کند</div>
    <ul class="req-list">
      <li><b>نرخ حقیقی.</b> نرخ اسمی به‌تنهایی گمراه‌کننده است.${inflation != null ? ` با تورم ${faPercent(inflation)}،` : ''}
        سپرده یک‌ساله با سود ۲۳ درصد بازده حقیقی منفی دارد، بنابراین امتیاز آن جریمه می‌شود.
        در مقابل، تسهیلات قرض‌الحسنه با کارمزد ۴ درصد پاداش می‌گیرد چون ارزش حقیقی بزرگی برای وام‌گیرنده ایجاد می‌کند.</li>
      <li><b>هزینه فرصت.</b> تسهیلات سپرده‌محور امتیاز کمتری می‌گیرند، چون پولی که برای امتیازسازی خواب می‌ماند
        از بازده بازار محروم می‌شود و تورم آن را می‌فرساید.</li>
      <li><b>اعتبار منبع.</b> رکوردهای گردآوری خودکار، کم‌اطمینان یا نیازمند بازبینی حداکثر ۸ درصد امتیاز کمتری می‌گیرند.</li>
    </ul>

    <div class="section-title">فیلتر نوع عقد (تسهیلات و اعتبار)</div>
    <p style="font-size:var(--fs-xs);line-height:2.05;color:var(--text-2)">
      تسهیلات بر پایه سه خانواده عقد تفکیک می‌شوند: <b>قرض‌الحسنه</b> (کارمزد یک‌بار روی اصل)،
      <b>عقود غیرمشارکتی/مبادله‌ای</b> (مرابحه، مزارعه، اجاره و مانند آن‌ها) و <b>عقود مشارکتی</b>
      (مضاربه و مشارکت). اگر رکورد نوع عقد را صریح ثبت نکرده باشد، از خود رکورد استنتاج می‌شود:
      محصولات کارمزد‌محور (rateKind: fee) قطعاً قرض‌الحسنه‌اند؛ ذکر صریح مشارکت یا مضاربه در متن
      آن‌ها را مشارکتی می‌شمارد؛ و تسهیلات سودمحور دیگر — در غیاب ذکر صریح — چون غلبه عملی
      و سقف‌های مصوب شورای پول و اعتبار با عقد مبادله‌ای هم‌خوان است، غیرمشارکتی فرض می‌شوند.
      محصولات بدون نرخ «نامشخص» می‌مانند؛ برای آن‌ها ادعایی شکل نمی‌گیرد.
    </p>

    <div class="section-title">مسئولیت‌پذیری داده</div>
    <p style="font-size:var(--fs-xs);line-height:2.05;color:var(--text-2)">
      هر رکورد منبع و تاریخ کنترل دارد. رکوردهایی که در آخرین واکشی دیده نشوند حذف نمی‌شوند بلکه
      با نشان «نیازمند بازبینی» مشخص می‌شوند، تا اطلاعات تاریخی از دست نرود.
      نرخ‌های سود تابع مصوبات شورای پول و اعتبار و بخشنامه‌های بانک مرکزی است و بانک‌ها می‌توانند
      شرایط را تغییر دهند؛ پیش از هر اقدام، شرایط را از منبع رسمی بانک تأیید کنید.
    </p>
  </div>`;
}

/* ---------- منابع پاصفحه ---------- */

export function footerHTML() {
  const s = summary();
  const sources = [
    ['بانک مرکزی جمهوری اسلامی ایران', 'https://www.cbi.ir'],
    ['رده — مقایسه خدمات بانکی', 'https://www.rade.ir/loan/'],
    ['مرکز آمار ایران', 'https://www.amar.org.ir'],
    ['بانک ملی ایران', 'https://bmi.ir'],
    ['بانک ملت', 'https://bankmellat.ir'],
    ['بلوبانک', 'https://blubank.com'],
    ['بانک قرض‌الحسنه مهر ایران', 'https://qmb.ir'],
  ];

  return `
  <footer class="footer">
    <div class="footer-grid">
      <div>
        <h4>درباره سامانه</h4>
        <p>
          رادار محصولات مالی و بانکی ایران، انواع سپرده‌ها، صندوق‌های درآمد ثابت، تسهیلات و اعتبارات را
          با امتیازدهی شفاف و تعدیل‌شده نسبت به تورم مقایسه می‌کند.
          کد و داده‌ها باز هستند و خط لوله به‌روزرسانی به‌صورت خودکار اجرا می‌شود.
        </p>
      </div>
      <div>
        <h4>منابع اصلی داده</h4>
        <ul>
          ${sources
            .slice(0, 4)
            .map(([name, url]) => `<li><a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></li>`)
            .join('')}
          <li><a href="https://fipiran.ir" target="_blank" rel="noopener noreferrer">مرکز پردازش اطلاعات مالی ایران (فیپیران)</a></li>
        </ul>
      </div>
      <div>
        <h4>بانک‌های پایش‌شده</h4>
        <ul>
          ${sources
            .slice(4)
            .map(([name, url]) => `<li><a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></li>`)
            .join('')}
        </ul>
      </div>
      <div>
        <h4>کیفیت داده</h4>
        <ul>
          <li>رکورد با اطمینان بالا: <b class="num">${fa(s.confidence.high)}</b></li>
          <li>گردآوری خودکار: <b class="num">${fa(s.auto)}</b></li>
          <li>بازبینی‌شده در ۳۰ روز: <b class="num">${fa(s.verified30)}</b></li>
          <li>منبع به‌روز در ۳۰ روز: <b class="num">${fa(s.sourceFresh30)}</b></li>
          <li>نیازمند بازبینی: <b class="num">${fa(s.stale)}</b></li>
        </ul>
      </div>
    </div>
    <p class="footer-note">
      این سامانه ابزار مقایسه و اطلاع‌رسانی است و توصیه سرمایه‌گذاری یا اعتباری محسوب نمی‌شود.
      نرخ‌ها و شرایط محصولات توسط بانک‌ها قابل تغییر است؛ پیش از اقدام، منبع رسمی را بررسی کنید.
      · آخرین به‌روزرسانی داده: ${esc(faDate(store.products.map((p) => p.lastUpdated).filter(Boolean).sort().pop()))}
    </p>
  </footer>`;
}

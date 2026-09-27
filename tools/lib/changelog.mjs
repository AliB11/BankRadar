/**
 * موتور تفاوت‌سنجی هوشمند محصولات برای تولید CHANGELOG هفتگی.
 *
 * مقایسه دو نسخه از products.json و دسته‌بندی تغییرات:
 *  - added: محصول جدید
 *  - removed: محصولی که stale شده یا حذف منطقی شده
 *  - rateChanged: نرخ تغییر کرده
 *  - amountChanged: سقف/کف مبلغ تغییر کرده
 *  - termChanged: مدت تغییر کرده
 *  - confidenceChanged: سطح اطمینان تغییر کرده
 *  - revived: محصولی که از stale به فعال برگشته
 */

import { foldForMatch } from './parse.mjs';

export function diffProducts(oldProducts = [], newProducts = []) {
  const oldById = new Map(oldProducts.map((p) => [p.id, p]));
  const newById = new Map(newProducts.map((p) => [p.id, p]));

  const added = [];
  const removed = [];
  const rateChanged = [];
  const amountChanged = [];
  const termChanged = [];
  const confidenceChanged = [];
  const revived = [];
  const staleNow = [];

  for (const [id, np] of newById) {
    const op = oldById.get(id);
    if (!op) {
      added.push({
        id,
        bank: np.bank,
        product: np.product,
        category: np.category,
        rate: np.rate,
        maxAmount: np.maxAmount,
      });
      continue;
    }

    // بازگشت از stale
    if (op.stale === true && np.stale !== true) {
      revived.push({ id, bank: np.bank, product: np.product });
    }

    if (op.rate !== np.rate) {
      const delta = Number((np.rate - op.rate).toFixed(2));
      rateChanged.push({
        id,
        bank: np.bank,
        product: np.product,
        from: op.rate,
        to: np.rate,
        delta,
        oldRate: op.rate,
        newRate: np.rate,
        diff: delta,
      });
    }

    if (op.maxAmount !== np.maxAmount || op.minAmount !== np.minAmount) {
      amountChanged.push({
        id,
        bank: np.bank,
        product: np.product,
        from: { min: op.minAmount, max: op.maxAmount },
        to: { min: np.minAmount, max: np.maxAmount },
        oldMax: op.maxAmount,
        newMax: np.maxAmount,
      });
    }

    if (op.termMonths !== np.termMonths) {
      termChanged.push({
        id,
        bank: np.bank,
        product: np.product,
        from: op.termMonths,
        to: np.termMonths,
        oldTerm: op.termMonths,
        newTerm: np.termMonths,
      });
    }

    if (op.confidence !== np.confidence) {
      confidenceChanged.push({
        id,
        bank: np.bank,
        product: np.product,
        from: op.confidence,
        to: np.confidence,
      });
    }

    if (np.stale === true && op.stale !== true) {
      staleNow.push({ id, bank: np.bank, product: np.product });
    }
  }

  for (const [id, op] of oldById) {
    if (!newById.has(id)) {
      removed.push({
        id,
        bank: op.bank,
        product: op.product,
        category: op.category,
        reason: 'no-longer-seen',
      });
    }
  }

  return {
    added,
    removed,
    rateChanged,
    amountChanged,
    termChanged,
    confidenceChanged,
    revived,
    staleNow,
    summary: {
      added: added.length,
      removed: removed.length,
      rateChanged: rateChanged.length,
      amountChanged: amountChanged.length,
      termChanged: termChanged.length,
      confidenceChanged: confidenceChanged.length,
      revived: revived.length,
      staleNow: staleNow.length,
      totalChanges:
        added.length +
        removed.length +
        rateChanged.length +
        amountChanged.length +
        termChanged.length +
        confidenceChanged.length +
        revived.length +
        staleNow.length,
    },
  };
}

export function changelogToMarkdown(diff, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# تغییرات هفتگی بانک‌رادار — ${date}`);
  lines.push('');
  lines.push(`**خلاصه**: ${diff.summary.added} افزوده، ${diff.summary.rateChanged} تغییر نرخ، ${diff.summary.staleNow} نیازمند بازبینی، ${diff.summary.revived} بازگشته، ${diff.summary.removed} حذف منطقی`);
  lines.push('');

  const section = (title, items, fmt) => {
    if (!items.length) return;
    lines.push(`## ${title} (${items.length})`);
    lines.push('');
    for (const it of items.slice(0, 50)) {
      lines.push(`- ${fmt(it)}`);
    }
    if (items.length > 50) lines.push(`- ... و ${items.length - 50} مورد دیگر`);
    lines.push('');
  };

  section('محصولات جدید', diff.added, (it) => `${it.bank} — ${it.product} (نرخ ${it.rate ?? '—'}٪، دسته ${it.category})`);
  section('تغییر نرخ', diff.rateChanged, (it) => `${it.bank} — ${it.product}: ${it.from}٪ → ${it.to}٪ (${it.delta > 0 ? '+' : ''}${it.delta}٪)`);
  section('تغییر سقف مبلغ', diff.amountChanged, (it) => `${it.bank} — ${it.product}: ${it.from.max ?? '—'} → ${it.to.max ?? '—'}`);
  section('بازگشته از نیازمند بازبینی', diff.revived, (it) => `${it.bank} — ${it.product}`);
  section('نیازمند بازبینی جدید', diff.staleNow, (it) => `${it.bank} — ${it.product}`);
  section('حذف منطقی', diff.removed, (it) => `${it.bank} — ${it.product} (${it.reason})`);

  if (diff.summary.totalChanges === 0) {
    lines.push('> هیچ تغییر محتوایی نسبت به هفته قبل مشاهده نشد.');
    lines.push('');
  }

  lines.push('---');
  lines.push('*این فایل به‌طور خودکار توسط `tools/lib/changelog.mjs` تولید می‌شود.*');
  return lines.join('\n');
}

export function changelogToRSS(diff, opts = {}) {
  const date = opts.date || new Date().toISOString();
  const link = opts.link || 'https://alib11.github.io/BankRadar/';
  const items = [
    ...diff.added.map((it) => ({
      title: `جدید: ${it.bank} — ${it.product}`,
      desc: `محصول جدید در دسته ${it.category} با نرخ ${it.rate ?? '—'}٪`,
    })),
    ...diff.rateChanged.map((it) => ({
      title: `تغییر نرخ: ${it.bank} — ${it.product}`,
      desc: `نرخ از ${it.from}٪ به ${it.to}٪ تغییر کرد (${it.delta > 0 ? '+' : ''}${it.delta}٪)`,
    })),
    ...diff.staleNow.map((it) => ({
      title: `نیازمند بازبینی: ${it.bank} — ${it.product}`,
      desc: `این محصول در آخرین واکشی دیده نشد`,
    })),
  ].slice(0, 100);

  const rssItems = items
    .map(
      (it) => `
    <item>
      <title><![CDATA[${it.title}]]></title>
      <description><![CDATA[${it.desc}]]></description>
      <link>${link}</link>
      <pubDate>${new Date(date).toUTCString()}</pubDate>
      <guid>${link}#${Date.now()}-${Math.random().toString(36).slice(2)}</guid>
    </item>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>بانک‌رادار — فید تغییرات هفتگی</title>
  <link>${link}</link>
  <description>تغییرات محصولات بانکی ایران — افزوده، تغییر نرخ، نیازمند بازبینی</description>
  <language>fa-IR</language>
  <lastBuildDate>${new Date(date).toUTCString()}</lastBuildDate>
  ${rssItems}
</channel>
</rss>`;
}

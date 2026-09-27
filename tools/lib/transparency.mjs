/**
 * شاخص شفافیت و سلامت بانک‌ها — امتیازدهی بانک نه فقط بر پایه نرخ، بلکه
 * بر پایه کیفیت داده، تازگی، اطمینان، و پوشش دیجیتال.
 *
 * هر بانک امتیازی ۰-۱۰۰ می‌گیرد:
 *  - تازگی (۳۰): میانگین freshnessScore محصولات
 *  - اطمینان (۳۰): نسبت high / total
 *  - پوشش دیجیتال (۲۰): میانگین digital
 *  - عدم کهنگی (۲۰): ۱ - stale/total
 *
 * همچنین بررسی لینک مرده (اختیاری، با شبکه) می‌تواند امتیاز را تعدیل کند.
 */

import { daysSince } from './parse.mjs';

function freshnessScore(iso) {
  const d = daysSince(iso);
  if (!Number.isFinite(d)) return 20;
  if (d <= 7) return 100;
  if (d <= 30) return 100 - (d - 7) * (28 / 23);
  if (d <= 90) return 72 - (d - 30) * 0.5;
  if (d <= 180) return 42 - (d - 90) * 0.2;
  return Math.max(5, 24 - (d - 180) * (19 / 240));
}

export function bankTransparency(products = []) {
  const byBank = new Map();
  for (const p of products) {
    const key = p.bank || 'نامشخص';
    if (!byBank.has(key)) byBank.set(key, []);
    byBank.get(key).push(p);
  }

  const result = [];
  for (const [bank, list] of byBank) {
    const total = list.length;
    const high = list.filter((p) => p.confidence === 'high').length;
    const stale = list.filter((p) => p.stale).length;
    const avgFresh = list.reduce((a, p) => a + freshnessScore(p.lastSeen || p.lastUpdated), 0) / Math.max(1, total);
    const avgDigital = list.reduce((a, p) => a + (p.digital ?? 50), 0) / Math.max(1, total);
    const regulatory = list.filter((p) => p.regulatory).length;

    const score = Math.round(
      (avgFresh / 100) * 30 +
        (high / Math.max(1, total)) * 30 +
        (avgDigital / 100) * 20 +
        (1 - stale / Math.max(1, total)) * 20,
    );

    result.push({
      bank,
      bankId: list[0]?.bankId || null,
      total,
      highConfidence: high,
      stale,
      regulatory,
      avgFreshness: Math.round(avgFresh),
      avgDigital: Math.round(avgDigital),
      transparencyScore: score,
      tone: score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad',
    });
  }

  return result.sort((a, b) => b.transparencyScore - a.transparencyScore);
}

export function overallHealthTrend(history = []) {
  // history: آرایه‌ای از weekly-report.stats
  // خروجی: آرایه‌ای مرتب برای نمودار
  return history
    .map((h) => ({
      date: h.generatedAt?.slice(0, 10) || h.period || '',
      health: h.stats?.healthScore ?? h.healthScore ?? 0,
      freshness: h.stats?.freshnessPercent ?? 0,
      total: h.stats?.totalProducts ?? h.counts?.total ?? 0,
      anomalies: h.anomalies?.total ?? 0,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

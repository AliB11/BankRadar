/**
 * آزمون لایهٔ «منبع جایگزین».
 *
 * چرا حیاتی است: این لایه تصمیم می‌گیرد یک پاسخ «داده» است یا «صفحهٔ خطا»، و
 * اگر این تصمیم غلط باشد، دادهٔ کهنه یا خالی با برچسب «تازه» وارد سامانه
 * می‌شود. هیچ آزمونی اینجا به شبکهٔ واقعی نیاز ندارد؛ `fetchImpl` تزریق می‌شود.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyContent,
  waybackTimestampToISO,
  daysBetween,
  rawSnapshotUrl,
  fetchResilient,
  summarizeAttempts,
} from '../tools/lib/resilience.mjs';

const PAGE = `<html><body>${'<p>نرخ سود سپرده بلندمدت یک‌ساله ۲۰٫۵ درصد است.</p>'.repeat(20)}</body></html>`;
const NOT_FOUND = '<html><body><h1>Page Not Found</h1><p>The page could not be found or has been removed</p></body></html>';
const GEO = '<html><body><h1>فیلترشکن خود را خاموش کنید</h1></body></html>';

/** ساخت fetch ساختگی از نقشهٔ url → پاسخ */
function fakeFetch(map) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const hit = Object.entries(map).find(([key]) => url.startsWith(key));
    if (!hit) throw new Error(`شبکه در دسترس نبود — ${url}`);
    const value = hit[1];
    if (value instanceof Error) throw value;
    return value;
  };
  fn.calls = calls;
  return fn;
}

/* ---------- تشخیص محتوا ---------- */

test('classifyContent صفحهٔ «Page Not Found» با کد ۲۰۰ را نامعتبر می‌داند', () => {
  const verdict = classifyContent({ status: 200, body: NOT_FOUND });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.blocked, 'notfound');
});

test('classifyContent ژئوبلاک ایرانی را می‌شناسد', () => {
  const verdict = classifyContent({ status: 200, body: GEO });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.blocked, 'geo');
  assert.match(verdict.reason, /ژئوبلاک/);
});

test('classifyContent ژئوبلاک انگلیسی (بنکd ملی) را می‌شناسد', () => {
  const body = '<h1>Error 403 | Access Denied</h1><p>The request has been blocked from your IP or your location!</p>';
  const verdict = classifyContent({ status: 403, body });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.blocked, 'waf');
});

test('classifyContent محتوای کوتاه را «ناکافی» می‌داند', () => {
  const verdict = classifyContent({ status: 200, body: '<html>ok</html>', minBytes: 400 });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.blocked, 'thin');
});

test('classifyContent صفحهٔ سالم را معتبر می‌داند', () => {
  assert.equal(classifyContent({ body: PAGE }).valid, true);
});

/* ---------- ابزار Wayback ---------- */

test('waybackTimestampToISO تاریخ فشرده را درست تبدیل می‌کند', () => {
  assert.equal(waybackTimestampToISO('20261012075233'), '2026-10-12T07:52:33Z');
  assert.equal(waybackTimestampToISO('20261012'), '2026-10-12T00:00:00Z');
  assert.equal(waybackTimestampToISO('نامعتبر'), null);
});

test('rawSnapshotUrl نسخهٔ خام (id_) می‌سازد', () => {
  assert.equal(
    rawSnapshotUrl('http://web.archive.org/web/20261012075233/https://dgshahr.com/x/'),
    'http://web.archive.org/web/20261012075233id_/https://dgshahr.com/x/',
  );
});

test('daysBetween اختلاف روز را بدون منفی برمی‌گرداند', () => {
  assert.equal(daysBetween('2026-10-12T00:00:00Z', '2026-11-03T00:00:00Z'), 22);
  assert.equal(daysBetween('2026-11-03T00:00:00Z', '2026-10-12T00:00:00Z'), 0);
  assert.equal(daysBetween('نامعتبر', '2026-11-03T00:00:00Z'), null);
});

/* ---------- زنجیرهٔ جایگزین ---------- */

test('مسیر مستقیم سالم → via=direct', async () => {
  const fetchImpl = fakeFetch({ 'https://a.example/': PAGE });
  const res = await fetchResilient('https://a.example/', { fetchImpl, allowWayback: false, allowProxy: false });
  assert.equal(res.via, 'direct');
  assert.equal(res.degraded, false);
  assert.equal(res.ageDays, 0);
});

test('ژئوبلاک در مسیر مستقیم → آینه پاسخ می‌دهد', async () => {
  const fetchImpl = fakeFetch({
    'https://geo.example/': GEO,
    'https://mirror.example/': PAGE,
  });
  const res = await fetchResilient('https://geo.example/', {
    fetchImpl,
    mirrors: ['https://mirror.example/'],
    allowWayback: false,
    allowProxy: false,
  });
  assert.equal(res.via, 'mirror');
  assert.equal(res.resolvedUrl, 'https://mirror.example/');
  // تلاش ناموفق با دلیلش ثبت شده است، نه پنهان
  assert.equal(res.attempts[0].ok, false);
  assert.match(res.attempts[0].reason, /ژئوبلاک/);
});

test('همه مسیرها بسته → آرشیو با تاریخ خودش، نه امروز', async () => {
  const fetchImpl = fakeFetch({
    'https://archive.org/wayback/available': JSON.stringify({
      archived_snapshots: {
        closest: {
          available: true,
          status: '200',
          url: 'http://web.archive.org/web/20261012075233/https://geo.example/',
          timestamp: '20261012075233',
        },
      },
    }),
    'http://web.archive.org/web/20261012075233id_/': PAGE,
  });
  const now = () => new Date('2026-11-03T00:00:00Z');
  const res = await fetchResilient('https://geo.example/', {
    fetchImpl,
    allowProxy: false,
    now,
  });
  assert.equal(res.via, 'wayback');
  assert.equal(res.observedAt, '2026-10-12T07:52:33Z');
  assert.equal(res.ageDays, 21);
  assert.equal(res.degraded, true, 'داده آرشیوی باید «کاهش اطمینان» داشته باشد');
});

test('آرشیو هم نیست → پروکسی متن آخرین راه است و degraded می‌شود', async () => {
  const fetchImpl = fakeFetch({
    'https://r.jina.ai/': PAGE,
  });
  const res = await fetchResilient('https://geo.example/', { fetchImpl, allowProxy: true });
  assert.equal(res.via, 'proxy');
  assert.equal(res.degraded, true);
  assert.ok(res.attempts.some((a) => a.via === 'wayback' && a.ok === false));
});

test('همه مسیرها بسته → خطای AllSourcesFailed با فهرست تلاش‌ها', async () => {
  const fetchImpl = fakeFetch({});
  await assert.rejects(
    () => fetchResilient('https://dead.example/', { fetchImpl, allowProxy: true }),
    (err) => {
      assert.equal(err.name, 'AllSourcesFailed');
      assert.ok(Array.isArray(err.attempts));
      assert.ok(err.attempts.length >= 2);
      assert.ok(err.attempts.every((a) => a.ok === false));
      return true;
    },
  );
});

test('صفحهٔ «پیدا نشد» با کد ۲۰۰ باعث پرش به مسیر بعدی می‌شود (خطای بی‌صدای سابق)', async () => {
  const fetchImpl = fakeFetch({
    'https://dead.example/': NOT_FOUND,
    'https://mirror.example/': PAGE,
  });
  const res = await fetchResilient('https://dead.example/', {
    fetchImpl,
    mirrors: ['https://mirror.example/'],
    allowWayback: false,
    allowProxy: false,
  });
  assert.equal(res.via, 'mirror');
  assert.match(res.attempts[0].reason, /پیدا نشد/);
});

test('summarizeAttempts زنجیره را خوانا خلاصه می‌کند', () => {
  const summary = summarizeAttempts([
    { via: 'direct', ok: false, reason: 'ژئوبلاک' },
    { via: 'wayback', ok: true },
  ]);
  assert.match(summary, /direct✗/);
  assert.match(summary, /wayback✓/);
  assert.equal(summarizeAttempts([]), 'بدون تلاش');
});

/* ---------- داوری سیگنال هدف بانکی ---------- */

test('assessTargetSignal سه حالت را از هم جدا می‌کند', async () => {
  const { assessTargetSignal } = await import('../tools/sources/banks.mjs');

  const fresh = assessTargetSignal({ rates: [24], ageDays: 3, keywords: ['سپرده'] });
  assert.equal(fresh.trustworthy, true);

  const empty = assessTargetSignal({ rates: [], keywords: ['سپرده'], ageDays: 0 });
  assert.equal(empty.trustworthy, false, 'صفحهٔ بدون نرخ، شاهد نرخ نیست');
  assert.equal(empty.empty, undefined); // assess فقط داوری می‌کند؛ برچسب در collect زده می‌شود
  assert.equal(empty.weak, true);

  const stale = assessTargetSignal({ rates: [23], ageDays: 324 });
  assert.equal(stale.hasSignal, true);
  assert.equal(stale.staleSnapshot, true);
  assert.equal(stale.trustworthy, false, 'snapshot یک‌ساله نباید «تأیید امروز» شمرده شود');
});

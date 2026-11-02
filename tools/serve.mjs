#!/usr/bin/env node
/**
 * سرور ایستا برای پیش‌نمایش محلی.
 * بدون وابستگی خارجی؛ برای توسعه و بررسی سریع سامانه.
 *
 * استفاده:
 *   node tools/serve.mjs           # پورت 4173
 *   PORT=8080 node tools/serve.mjs
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

let syncInFlight = false;

/** محافظ CSRF برای عملیات نوشتنی؛ میزبان عمومی پروکسی نیز پشتیبانی می‌شود. */
export function sameOriginPost(req) {
  if (!req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  if (!['http', 'https'].includes(proto) || !host) return false;
  try { return new URL(req.headers.origin).origin === new URL(`${proto}://${host}`).origin; }
  catch { return false; }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API نوشتنی فقط از صفحه هم‌مبدأ با JSON قابل فراخوانی است. CORS باز و
    // درخواست‌های ساده cross-origin نباید اجرای جمع‌آوری/بازنویسی داده را شروع کنند.
    if (req.method === 'OPTIONS') {
      res.writeHead(405, { Allow: 'GET, POST' }).end();
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/api/refresh' || url.pathname === '/api/sync')) {
      if (!sameOriginPost(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'درخواست باید هم‌مبدأ و JSON باشد' }));
        return;
      }
      if (syncInFlight) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'همگام‌سازی دیگری در حال اجراست' }));
        return;
      }
      syncInFlight = true;
      try {
        const { syncWeekly } = await import('./sync-weekly.mjs');
        const result = await syncWeekly({ offline: false });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, report: result?.report ?? {} }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      } finally {
        syncInFlight = false;
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }));
      return;
    }

    let filePath = decodeURIComponent(url.pathname);
    if (filePath.endsWith('/')) filePath += 'index.html';

    const absolute = path.resolve(path.join(ROOT, filePath));
    // جلوگیری از خروج از ریشه پروژه. مقایسه پیشوندی ساده (startsWith) کافی
    // نیست: نشانی‌های رمزگذاری‌شده مثل «..%2f..%2fetc/passwd» پس از decode
    // از ریشه بیرون می‌زنند و چون رشته‌شان می‌تواند با ROOT شروع شود، از فیلتر
    // ساده رد می‌شدند.
    const rel = path.relative(ROOT, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // پوشه .git (و هر مسیر پنهان دیگری) هرگز سرو نمی‌شود؛ این سرور گاهی از
    // پشت پروکسی پیش‌نمایش هم در دسترس است و افشای .git/config و credentials
    // پذیرفتنی نیست.
    if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('یافت نشد');
      return;
    }

    const target = stat.isDirectory() ? path.join(absolute, 'index.html') : absolute;
    // symlink درون ریشه هم نباید خواندن فایل خارج از مخزن یا مسیر پنهان را ممکن کند.
    const realTarget = await fs.realpath(target);
    const realRel = path.relative(await fs.realpath(ROOT), realTarget);
    if (realRel.startsWith('..') || path.isAbsolute(realRel) || realRel.split(path.sep).some((seg) => seg.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await fs.readFile(realTarget);
    const ext = path.extname(target).toLowerCase();

    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`خطای سرور: ${err.message}`);
  }
});

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) server.listen(PORT, HOST, () => {
  console.log(`بانک‌رادار روی http://localhost:${server.address().port} در حال اجراست`);
  console.log(`ریشه: ${ROOT}`);
});

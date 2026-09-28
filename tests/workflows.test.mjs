/**
 * آزمون جریان‌های کاری GitHub Actions.
 *
 * YAML در Node بدون وابستگی بیرونی تجزیه نمی‌شود و این پروژه عمداً هیچ
 * وابستگی npm ندارد؛ پس بلوک‌های `run:` با یک تجزیه‌گر خطوطِ ساده بیرون کشیده
 * می‌شوند و همان چیزی سنجیده می‌شود که واقعاً روی دونده اجرا می‌شود:
 *
 *   ۱. نحو bash معتبر است (با همان گزینه‌هایی که Actions استفاده می‌کند)
 *   ۲. هر جا لوله (pipeline) هست، pipefail فعال است — وگرنه کد خطای پشت
 *      `| tee` پنهان می‌شود و اجرای شکست‌خورده «موفق» گزارش می‌گردد
 *   ۳. دام `set -e` با الگوی `[ شرط ] && دستور` بسته نمی‌شود
 *   ۴. عبارت‌های `${{ }}` داخل پوسته از ورودی‌های کنترل‌شده کاربر نمی‌آیند
 *      (تزریق دستور در Actions)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/**
 * بیرون کشیدن بلوک‌های پوسته از YAML با پیمایش خطوط.
 * @param {string} source
 * @returns {{name:string, script:string, indent:number}[]}
 */
function extractRunBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let lastName = '(بدون نام)';

  for (let i = 0; i < lines.length; i += 1) {
    const nameMatch = lines[i].match(/^\s*-?\s*name:\s*(.+?)\s*$/);
    if (nameMatch && !lines[i].includes('|')) lastName = nameMatch[1].replace(/^['"]|['"]$/g, '');

    const runMatch = lines[i].match(/^(\s*)run:\s*(.*)$/);
    if (!runMatch) continue;

    const indent = runMatch[1].length;
    const inline = runMatch[2].trim();

    if (inline && inline !== '|' && inline !== '|-' && inline !== '>' && inline !== '>-') {
      blocks.push({ name: lastName, script: inline, indent });
      continue;
    }

    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line.trim() === '') {
        body.push('');
        j += 1;
        continue;
      }
      const lineIndent = line.match(/^\s*/)[0].length;
      if (lineIndent <= indent) break;
      body.push(line);
      j += 1;
    }

    // حذف تورفتگی مشترک
    const dedent = Math.min(
      ...body.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)[0].length),
    );
    blocks.push({
      name: lastName,
      script: body.map((l) => (l.trim() === '' ? '' : l.slice(dedent))).join('\n'),
      indent,
    });
    i = j - 1;
  }
  return blocks;
}

test('دست‌کم سه جریان کاری موجود است', () => {
  assert.ok(files.length >= 3, `تعداد جریان‌های کاری: ${files.length}`);
  for (const f of ['ci.yml', 'deploy-pages.yml', 'refresh-data.yml']) {
    assert.ok(files.includes(f), `${f} وجود ندارد`);
  }
});

test('همه بلوک‌های پوسته از نظر نحو معتبرند', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-syntax-'));
  const bad = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    for (const [i, block] of extractRunBlocks(source).entries()) {
      // همان گزینه‌هایی که Actions برای shell: bash به کار می‌برد
      const scriptPath = path.join(tmp, `${file}-${i}.sh`);
      fs.writeFileSync(scriptPath, block.script, 'utf8');
      const res = spawnSync('bash', ['--noprofile', '--norc', '-n', scriptPath], { encoding: 'utf8' });
      if (res.status !== 0) bad.push(`${file} → ${block.name}: ${res.stderr.trim().split('\n')[0]}`);
    }
  }

  assert.deepEqual(bad, [], `خطای نحو در پوسته:\n${bad.join('\n')}`);
});

test('هر بلوکی که لوله دارد، pipefail را فعال می‌کند', () => {
  const risky = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    // shell: bash در سطح شغل (defaults) یا سطح مرحله، pipefail را فعال می‌کند
    const bashShell = /^\s*shell:\s*bash\s*$/m.test(source);
    for (const block of extractRunBlocks(source)) {
      // لوله واقعی: `|` که `||` نباشد
      const hasPipe = /(^|[^|])\|(?!\|)/m.test(block.script);
      if (hasPipe && !bashShell && !/set -o pipefail/.test(block.script)) {
        risky.push(`${file} → ${block.name}`);
      }
    }
  }

  assert.deepEqual(
    risky,
    [],
    `این بلوک‌ها لوله دارند ولی pipefail فعال نیست (کد خطا پشت tee پنهان می‌شود):\n${risky.join('\n')}`,
  );
});

test('دام set -e با الگوی «[ شرط ] && دستور» بسته نمی‌شود', () => {
  // در پوسته‌ای که با -e اجرا می‌شود، اگر شرط نادرست باشد کل مرحله همان‌جا
  // بیرون می‌پرد؛ این الگو باید if/then نوشته شود یا `|| true` بگیرد.
  const traps = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    for (const block of extractRunBlocks(source)) {
      for (const line of block.script.split('\n')) {
        const t = line.trim();
        if (/^\[\s.*\]\s*&&/.test(t) && !/\|\|\s*true\s*$/.test(t)) traps.push(`${file} → ${block.name}: ${t}`);
      }
    }
  }
  assert.deepEqual(traps, [], `الگوی خطرناک با set -e:\n${traps.join('\n')}`);
});

test('عبارت‌های درون پوسته از ورودی‌های کنترل‌شده بیرونی نمی‌آیند', () => {
  // این عبارت‌ها پیش از اجرای پوسته جای‌گذاری می‌شوند؛ مقدار کاربر (عنوان
  // ایشو، متن نظر، نام شاخه PR) می‌تواند دستور تزریق کند.
  const DANGEROUS = [
    'github.event.issue.title',
    'github.event.issue.body',
    'github.event.comment.body',
    'github.event.review.body',
    'github.event.pull_request.title',
    'github.event.pull_request.body',
    'github.head_ref',
  ];
  const found = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    for (const block of extractRunBlocks(source)) {
      for (const expr of block.script.matchAll(/\$\{\{([^}]*)\}\}/g)) {
        for (const key of DANGEROUS) {
          if (expr[1].includes(key)) found.push(`${file} → ${block.name}: \${{ ${expr[1].trim()} }}`);
        }
      }
    }
  }
  assert.deepEqual(found, [], `خطر تزریق دستور:\n${found.join('\n')}`);
});

test('جریان به‌روزرسانی داده، ماشین‌های لازم را دارد', () => {
  const source = fs.readFileSync(path.join(WORKFLOWS, 'refresh-data.yml'), 'utf8');
  // زمان‌بندی روزانه و هفتگی
  assert.match(source, /cron:\s*'30 3 \* \* \*'/);
  assert.match(source, /cron:\s*'0 5 \* \* 4'/);
  // دسترسی لازم برای کامیت و ایشو
  assert.match(source, /contents:\s*write/);
  assert.match(source, /issues:\s*write/);
  // دروازه‌های کیفیت پیش از کامیت
  assert.ok(source.indexOf('validate-data.mjs') < source.indexOf('git commit'), 'اعتبارسنجی باید پیش از کامیت اجرا شود');
  assert.ok(source.indexOf('node --test') < source.indexOf('git commit'), 'آزمون‌ها باید پیش از کامیت اجرا شوند');
  assert.ok(source.indexOf('build-bundle.mjs') < source.indexOf('git commit'), 'بسته داده باید پیش از کامیت بازسازی شود');
  // همگام‌سازی پیش از push تا به‌روزرسانی روزانه رد نشود
  assert.match(source, /git pull --rebase/);
});

test('انتشار صفحات فقط از شاخه اصلی و با بسته کامل انجام می‌شود', () => {
  const source = fs.readFileSync(path.join(WORKFLOWS, 'deploy-pages.yml'), 'utf8');
  assert.match(source, /branches:\s*\[main\]/);
  assert.match(source, /id-token:\s*write/);
  assert.match(source, /pages:\s*write/);
  for (const asset of ['index.html', 'assets', 'data/products.json', 'data/bundle.js', '.nojekyll']) {
    assert.ok(source.includes(asset), `${asset} باید در بسته انتشار باشد`);
  }
});

/* ---------- زنجیره به‌روزرسانی هفتگی و انتشار ---------- */

test('push رباتِ داده، انتشار Pages را با workflow_dispatch راه می‌اندازد', () => {
  // کامیت‌های github-actions[bot] رویداد «push» برای سایر workflowها راه
  // نمی‌اندازد؛ اگر این زنجیره نباشد، به‌روزرسانی خودکار هرگز به سایت منتشرشده
  // نمی‌رسد (خطای واقعی نسخهٔ پیشین).
  for (const file of ['refresh-data.yml', 'weekly-sync.yml']) {
    const source = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    assert.match(source, /gh workflow run deploy-pages\.yml --ref main/, `${file} باید Pages را فراخوانی کند`);
    assert.match(source, /actions:\s*write/, `${file} برای workflow_dispatch به actions:write نیاز دارد`);
    assert.match(source, /changed == 'true'/, 'فراخوانی انتشار فقط در تغییر واقعی داده باشد');
  }
});

test('کرون پنجشنبه refresh-data در حالت هفتگی اجرا می‌شود نه روزانه', () => {
  // رویداد schedule ورودی (inputs) ندارد؛ حالت باید از خود عبارت cron
  // تشخیص داده شود وگرنه ممیزی جامع هفتگی بی‌صدا به واکشی روزانه ساده تنزل می‌یابد.
  const source = fs.readFileSync(path.join(WORKFLOWS, 'refresh-data.yml'), 'utf8');
  assert.match(source, /github\.event\.schedule == '0 5 \* \* 4' && 'weekly'/);
});

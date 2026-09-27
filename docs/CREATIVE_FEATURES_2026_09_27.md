# ویژگی‌های خلاقانه و هوشمند — ممیزی هفتگی بانک‌رادار

تاریخ: ۲۰۲۶-۰۹-۲۷
وضعیت: پیاده‌سازی‌شده و فعال

این سند چهار پیشنهاد خلاقانه تأییدشده توسط کاربر را مستند می‌کند که بر فراز سازوکار هفتگی خودکار ساخته شده‌اند.

---

## ۱) فید تغییرات هوشمند (Changelog Diff)

### ایده
به جای نمایش فقط «تعداد محصولات تغییر کرد»، تفاوت دو نسخه پایگاه داده را با جزئیات نرخ، سقف مبلغ، مدت و وضعیت کهنگی گزارش دهیم — هم برای انسان، هم برای ماشین.

### پیاده‌سازی
- `tools/lib/changelog.mjs`
  - `diffProducts(old, new)` → دسته‌بندی:
    - `added` — محصول جدید
    - `removed` — حذف منطقی
    - `rateChanged` — تغییر نرخ (oldRate/newRate/diff + from/to/delta)
    - `amountChanged` — تغییر سقف/کف مبلغ
    - `termChanged` — تغییر مدت
    - `confidenceChanged` — تغییر سطح اطمینان
    - `revived` — بازگشت از stale
    - `staleNow` — تازه کهنه‌شده
  - `changelogToMarkdown(diff, {date})` → `data/changelog.md`
  - `changelogToRSS(diff, {date, link})` → `data/feed.xml`

- `tools/generate-changelog.mjs` — ابزار مستقل برای تولید فید از دو نسخه محصولات
- `tools/sync-weekly.mjs` — در گام ۶.۵ پس از ادغام، diff را محاسبه و فایل‌ها را می‌نویسد:
  - `data/changelog.json`
  - `data/changelog.md`
  - `data/feed.xml`

- `assets/js/store.js` — بارگذاری اختیاری `changelog.json`
- `assets/js/views.js` — نمایش در مرکز داده:
  - خلاصه تعداد تغییرات
  - لیست ۵ محصول جدید و ۵ تغییر نرخ برتر
  - لینک به فیدهای باز

### خروجی‌های باز (Open Feed)
- `data/changelog.json` — JSON ماشین‌خوان
- `data/changelog.md` — متن انسانی
- `data/feed.xml` — RSS 2.0
- `data/weekly-report.json → changelog.summary`

---

## ۲) تاریخچه سلامت و روند تازگی (Health Trend)

### ایده
سلامت داده یک عدد لحظه‌ای نیست؛ باید روند ۵۲ هفته اخیر را ببینیم تا بفهمیم کیفیت در حال بهبود است یا افت.

### پیاده‌سازی
- `tools/sync-weekly.mjs`:
  - پس از تولید گزارش هفتگی، خلاصه‌ای از `stats`, `macro`, `counts`, `anomalies` و `changelogSummary` را به `data/history/weekly-history.json` می‌افزاید
  - نگهداری ۵۲ هفته اخیر (حداکثر)
  - همچنین `data/history/latest.json` برای دسترسی سریع UI

- `tools/lib/transparency.mjs`:
  - `overallHealthTrend(history)` — مرتب‌سازی و نرمال‌سازی برای نمودار

- `assets/js/store.js`:
  - بارگذاری `data/history/weekly-history.json`

- `assets/js/views.js`:
  - اگر تاریخچه ≥۲ هفته باشد: نمودار میله‌ای کوچک (bar sparkline) از سلامت ۲۰ هفته اخیر
  - اگر فقط گزارش جاری موجود باشد: نمایش کارت سلامت (healthScore, freshnessPercent, stale, anomalies)

- `weekly-sync.yml` و `deploy-pages.yml`:
  - آپلود artifact شامل تاریخچه
  - انتشار تاریخچه در `dist/data/history/`

### خروجی
- `data/history/weekly-history.json` — آرایه ۵۲ هفته‌ای
- `data/history/latest.json` — آخرین گزارش + diffSummary

---

## ۳) شاخص شفافیت بانک‌ها (Bank Transparency Score)

### ایده
بانک‌ها فقط با نرخ رقابت نمی‌کنند؛ با شفافیت هم رقابت می‌کنند. بانکی که داده‌اش به‌روز، با اطمینان بالا، دیجیتال و بدون کهنگی باشد، امتیاز شفافیت بالاتری می‌گیرد — مستقل از نرخ سود.

### فرمول (۰-۱۰۰)
```
شفافیت = (تازگی میانگین ۳۰٪) + (نسبت high-confidence ۳۰٪) + (پوشش دیجیتال ۲۰٪) + (عدم کهنگی ۲۰٪)
```

### پیاده‌سازی
- `tools/lib/transparency.mjs`:
  - `bankTransparency(products)` — گروه‌بندی بر پایه `bank`, محاسبه میانگین freshnessScore (از `daysSince`), میانگین digital, نسبت high, نسبت stale
  - خروجی مرتب‌شده نزولی با `tone: good|warn|bad`

- `tools/sync-weekly.mjs`:
  - محاسبه شفافیت برای همه محصولات ادغام‌شده
  - افزودن به گزارش هفتگی:
    ```json
    transparency: { banks: [top20], totalBanks, avgScore }
    ```

- `assets/js/store.js`:
  - اگر `weekly-report.json` شامل transparency باشد، از آن استفاده می‌کند
  - در غیر این صورت `computeTransparencyLocal(products)` محلی محاسبه می‌کند

- `assets/js/views.js`:
  - در مرکز داده، لیست ۱۰ بانک برتر با چیپ رنگی (سبز ≥۸۰، زرد ≥۶۰، قرمز <۶۰)
  - توضیح فرمول

### خروجی
- `data/weekly-report.json → transparency`
- UI: مرکز داده → شاخص شفافیت بانک‌ها

---

## ۴) شفافیت لینک مرده (Dead-Link Transparency)

### ایده
اگر منبع محصول ۴۰۴ باشد، کاربر باید بداند. لینک مرده = کاهش اعتماد، و باید شفاف گزارش شود.

### پیاده‌سازی
- `tools/check-links.mjs`:
  - ورودی: `data/products.json`
  - نمونه‌برداری هوشمند: اولویت با high-confidence و تازه‌ترها
  - پارامترها: `--limit=40..200`, `--concurrency=4..10`, `--offline` برای اسکیپ
  - روش: `HEAD` → در صورت 405، `GET` با Range 0-1024
  - خروجی: `data/link-health.json`
    ```json
    {
      "generatedAt": "...",
      "total": 40,
      "ok": 38,
      "dead": 2,
      "healthPercent": 95,
      "deadLinks": [...],
      "all": [...]
    }
    ```

- `.github/workflows/weekly-sync.yml`:
  - گام جدید «بررسی سلامت لینک‌ها (شفافیت)» پس از ممیزی هفتگی
  - اجرا فقط در حالت آنلاین و غیر آزمایشی
  - لاگ `link-check.log` و artifact شامل `link-health.json`

- `.github/workflows/deploy-pages.yml`:
  - انتشار `link-health.json` در `dist/data/`

- آینده: می‌توان deadLinks را در `transparency.mjs` برای تعدیل امتیاز شفافیت استفاده کرد (در حال حاضر گزارشی است).

---

## جمع‌بندی فنی

### فایل‌های جدید
- `tools/lib/changelog.mjs` — موتور diff + markdown + RSS
- `tools/lib/transparency.mjs` — شاخص شفافیت + روند سلامت
- `tools/generate-changelog.mjs` — CLI مستقل تولید changelog
- `tools/check-links.mjs` — بررسی سلامت لینک‌ها
- `tests/changelog.test.mjs` — آزمون changelog
- `tests/transparency.test.mjs` — آزمون شفافیت
- `docs/CREATIVE_FEATURES_2026_09_27.md` — این سند

### فایل‌های تغییر یافته
- `tools/sync-weekly.mjs` — ادغام changelog + transparency + history + feed
- `assets/js/store.js` — بارگذاری weekly-report, changelog, history, transparency
- `assets/js/views.js` — UI مرکز داده با تاریخچه، changelog، شفافیت، فید باز
- `.github/workflows/weekly-sync.yml` — افزودن link-check، artifact جدید
- `.github/workflows/deploy-pages.yml` — انتشار فیدهای جدید
- `.github/workflows/refresh-data.yml` — artifact جدید
- `package.json` — اسکریپت‌های جدید `changelog`, `transparency`

### آزمون‌ها
- ۱۶۸ → ۱۷۳ آزمون (۵ آزمون جدید)
- همه سبز

### زمان‌بندی خودکار
- هفتگی: شنبه ۰۴:۰۰ UTC (۰۷:۳۰ تهران) — `weekly-sync.yml`
- روزانه: ۰۳:۳۰ UTC — `refresh-data.yml`
- انتشار: پس از هر push به main — `deploy-pages.yml`

### فیدهای باز نهایی
- `data/products.json` — پایگاه اصلی
- `data/weekly-report.json` — گزارش کامل هفتگی + transparency + changelog.summary
- `data/changelog.json` — diff دقیق
- `data/changelog.md` — متن انسانی
- `data/feed.xml` — RSS
- `data/link-health.json` — سلامت لینک‌ها
- `data/history/weekly-history.json` — روند ۵۲ هفته
- `data/history/latest.json` — آخرین snapshot

این ویژگی‌ها سامانه را از یک «مقایسه‌گر ایستا» به یک «رادار زنده با حافظه تاریخی و شاخص پاسخگویی بانک‌ها» ارتقا می‌دهد.

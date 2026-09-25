<div dir="rtl" style="text-align: right;">

# Bosta Orders Shipped Scanner

![version](https://img.shields.io/badge/version-v3.6.2-blue)

سكانر شحن الأوردرات من بوسطة — الجزء الخلفي (Worker) لأداة مخزن EcomModa.

- **الواجهة:** جوّه [مركز عمليات المخزن](https://ecommoda-dev.github.io/Warehouse-Operations-Center/bosta-shipped.html) — **الريبو ده مالوش واجهة خالص**
- **الـ Worker:** `index.js` (Cloudflare Workers Builds)
- **القواعد والثوابت:** `CLAUDE.md`

> 🔴 **الريبو ده Worker وبس من 25-09-2026 (قرار أحمد).** كان فيه واجهة مستقلة
> (`index.html`) وكمان صفحة `bosta-shipped.html` في مركز عمليات المخزن —
> الواجهة المستقلة **اتشالت بالكامل**، ومفيش إعادة توجيه من الرابط القديم
> (`.../Bosta-Orders-Shipped-Scanner/` بيدّي `404` بقرار). التفاصيل الكاملة
> في `CLAUDE.md`.

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Warehouse-Operations-Center/bosta-shipped.html
الـ Worker : https://bosta-orders-shipped-scanner.ecommoda-dev.workers.dev
```

النشر أوتوماتيكي: أي `git push` على `main` بينشر الـ Worker (Workers Builds).
راجع `ecommoda-tool-migration-playbook` للتفاصيل.

## الإعدادات المطلوبة من الموظف

مفيش شاشة إعدادات في الريبو ده — الإعدادات (سر الـ Worker · رابط الـ Worker)
بتتضبط مرة واحدة في مركز عمليات المخزن (`warehouse_ops_worker_secret`) وبتتشارك
مع باقي أدوات المخزن.

## CORS

الـ Worker بيقبل نداءات من **`https://ecommoda-dev.github.io`** بس (Option B) —
ده بيغطّي صفحة `bosta-shipped.html` في مركز عمليات المخزن. فتح أي نسخة محلية
(`file://`) أو من أي دومين تاني مش هيوصل للـ Worker — ده مقصود.

## الأوردرات المرفوضة

الأوردر اللي الانتقال بتاعه مرفوض (مثلاً `S1` مش `Ready`) **ما بيتكتبش عليه أي
حاجة** — بس من v3.4 بقى **بيتسجّل**: صف في D1 بنوع `rejected` فيه رقم الأوردر
ورقم التتبع ونوع بوسطة والحالة اللي وقف عندها والسبب. بيبان في نافذة الملخّص
بعد التحديث، وفي تاب السجل (فلتر **"مرفوض (ما اتكتبش)"**).

## فحص سريع لما حاجة متبوّظة

- زرار **🩺 افحص الأداة والاتصالات** جوّه الإعدادات (في صفحة `bosta-shipped.html`
  بالهب) بينادي `?action=diag` وبيعرض حالة كل متغيّر (**الاسم والطول بس — مفيش
  قيم أسرار**) وصلاحيات تطبيق شوبيفاي وحالة بوسطة وD1.
- بادج **⚠️ الـ Worker نسخة قديمة** في هيدر الهب بيظهر لو الـ Worker المنشور
  أقدم من `WOC_WORKERS.shipped.min` — معناه Promote ناقص أو rollback.

آخر تحديث: 25-09-2026 — إزالة الواجهة المستقلة، الريبو ده Worker وبس

</div>

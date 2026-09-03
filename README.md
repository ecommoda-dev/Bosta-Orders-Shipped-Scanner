<div dir="rtl" style="text-align: right;">

# Bosta Orders Shipped Scanner

![version](https://img.shields.io/badge/version-v1.1.0-blue)

سكانر شحن الأوردرات من بوسطة — أداة مخزن داخلية لـ EcomModa.

- **الواجهة:** `index.html` (GitHub Pages)
- **الـ Worker:** `index.js` (Cloudflare Workers Builds)
- **القواعد والثوابت:** `CLAUDE.md`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Bosta-Orders-Shipped-Scanner/
الـ Worker : https://bosta-orders-shipped-scanner.ecommoda-dev.workers.dev
```

النشر أوتوماتيكي: أي `git push` على `main` بينشر الـ Worker (Workers Builds)
والواجهة (GitHub Pages). راجع `ecommoda-tool-migration-playbook` للتفاصيل.

## الإعدادات المطلوبة من الموظف

حقل واحد بس في شاشة الإعدادات: **WORKER SECRET**. رابط الـ Worker ورابط لوحة
الموظفين ثابتين في الكود (`§CONFIG`) — مش أسرار، والحماية في الـ Secret نفسه
وفي الـ CORS allowlist.

## فحص سريع لما حاجة متبوّظة

- زرار **🩺 افحص الأداة والاتصالات** جوّه الإعدادات بينادي `?action=diag`
  وبيعرض حالة كل متغيّر (**الاسم والطول بس — مفيش قيم أسرار**) وصلاحيات
  تطبيق شوبيفاي وحالة بوسطة وD1.
- بادج **⚠️ الـ Worker نسخة قديمة** في الهيدر بيظهر لو الـ Worker المنشور أقدم
  من `MIN_WORKER_VERSION` — معناه Promote ناقص أو rollback.

آخر تحديث: 03-09-2026 — 14:20

</div>

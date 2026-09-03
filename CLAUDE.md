<div dir="rtl" style="text-align: right;">

# سكانر شحن الأوردرات من بوسطة (`Bosta-Orders-Shipped-Scanner`)

![version](https://img.shields.io/badge/version-v2.0.0-blue)

**بتعمل إيه:** الموظف بيسكان تراكينج نمرة بوسطة، الأداة بتتأكد من نوع الشحنة وحالتها الحالية على شوبيفاي (S1/S2)، ولو الانتقال صحيح بتكتب الحالة `Shipped` وتعمل Fulfillment تلقائي.
**مين بيستخدمها:** المخزن — نقطة الشحن.
**الإصدار:** Worker `v3.2.0` · الواجهة `v3.2`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Bosta-Orders-Shipped-Scanner/
الـ Worker : https://bosta-orders-shipped-scanner.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: bosta-orders-shipped-scanner     ← لازم يطابق name في wrangler.toml
```

## الـ Endpoints

| `?action=` | بيعمل إيه |
|---|---|
| `check_employee` GET | فحص وجود الموظف وحالة PIN |
| `register_pin` POST | تسجيل PIN لأول مرة |
| `verify_employee` POST | تسجيل الدخول بالـ PIN |
| `log_logout` GET | تسجيل خروج |
| `get_employees` GET | قائمة الموظفين النشطين |
| `lookup` POST | بحث بوسطة (`trackingNumbers[]`) + فحص S1/S2 على شوبيفاي + التحقق من صلاحية الانتقال — بدون كتابة |
| `update` POST | إعادة تحقق من الحالة وقت الكتابة + `metafieldsSet` (S1 أو S2 = Shipped) + `fulfillmentCreate` (لو فيه OPEN fulfillmentOrders) + D1 log |
| `get_logs` | سجل العمليات — فلاتر server-side كقوايم (`employees` · `types`) + `search` + `dateFrom`/`dateTo` + pagination |
| `get_logs_count` | عدد الصفوف المطابقة **لنفس الفلاتر بالظبط** |
| `get_logs_export` | تصدير كامل حتى `LOG_EXPORT_MAX` (2000) — وبيرجّع `cap` و`total` و`truncated` معاه |
| `diag` GET | فحص ذاتي بدون كتابة: المتغيرات (اسم وطول فقط) · صلاحيات تطبيق شوبيفاي · بوسطة · D1 · الـ Origin |
| `get_config` GET | `WORKER_VERSION` — الواجهة بتقارنه بـ `MIN_WORKER_VERSION` عندها |

قاعدة الانتقال الوحيدة اللي الأداة دي بتفرضها (مؤكدة من أحمد):
```
Bosta orderType = "Send"     → لازم S1 = Ready               → يكتب S1 = Shipped
Bosta orderType = غير كده     → لازم S1 = Delivered و S2 = Ready → يكتب S2 = Shipped
```
أي حالة تانية بترفض مع سبب واضح ومتكتبش صامتة (order-lifecycle Rule 10).

## D1

```
tool  : bosta_tracker         → type: login · logout   (فقط — بقايا نظام التاجات القديم)
tool  : metafields_change     → type: update            (كتابة الحالة الفعلية)
                                 extra.sourceTool = "bosta_orders_shipped_scanner"
```

> `metafields_change` سجل مشترك بين أكتر من أداة — الفصل بمفتاح `extra.sourceTool`
> (راجع `ecommoda-constants` §7). القيمتين مسجّلتين هناك، مفيش قيم جديدة مطلوبة.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET · BOSTA_API_KEY
Vars     : SHOP_DOMAIN                                   ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي — لسه ما اتضيّقش)
```

## CORS

`wildcard *` — الأداة قراءة/بوسطة (Option A في الكود)، مش أداة مالية أو كتابة مباشرة على مخزون.

## خط الأساس بعد النقل

> ما اتاخدش رقم مباشر من أحمد قبل النقل. البديل من D1 (26-08 §0-ب): عدد صفوف
> الكتابة الفعلية (`metafields_change`/`update`, `extra.sourceTool = bosta_orders_shipped_scanner`)
> **قبل النقل = 893 صف**، آخر واحد `2026-09-02T11:35:43Z`. المقارنة بعد النقل
> على نفس الاستعلام:

```sql
SELECT COUNT(*) as total, MAX(timestamp) as last_ts FROM logs WHERE tool = 'metafields_change' AND type = 'update' AND extra LIKE '%"sourceTool":"bosta_orders_shipped_scanner"%';
```

> 🔴 بند ١٠ في قائمة التحقق (زرار "تحديث" جوه الأداة) **مفتوح بوعي** لحد ما
> يحصل أول سكان فعلي بعد النقل ويتقارن عدد الصفوف الجديد بالرقم فوق.

## فخاخ الأداة دي

- `businessReference` بتيجي من بوسطة بالـ `#` — أي مطابقة لازم تعدّي على
  `cleanOrderName()` وإلا كل أوردر بيترفض بـ "غير موجود على شوبيفاي" (باج
  v2.0.0 المُصلَّح في v3.0.1).
- `Metafield` مفيهوش حقل `ownerId` — الحقل الصح `owner { ... on Order { id } }`
  (مُصلَّح في v3.0.3).
- الفلفلمنت بيتعمل **بعد** كتابة الميتافيلد بنجاح، ومفيش rollback لو فشل —
  الصف بياخد `status = "warning"` (مش `success`) وبيتسجل في `extra.fulfillment`
  و`extra.result`.
- `.col-num` **ماكانش معرّف في الأداة دي** — الموجود `.col-mono`. الكلاس المش
  معرّف مابيغلطش، بيسكت: الخلايا بترجع `direction: rtl` فالتواريخ والأرقام
  بتتقلب. الاتنين معرّفين دلوقتي بنفس القيمة (v3.2).
- `checkWorkerVersion()` بتنادي `apiGet` اللي بتفتح شاشة الإعدادات لو مش
  مضبوطة — فيه حارس `isConfigured()` قبلها، وإلا الإعدادات بتفتح لوحدها فوق
  شاشة الدخول أول ما الموظف يفتح الأداة (v3.2).
- `dateFrom`/`dateTo` في فلتر السجل بيتقارنوا بالـ `timestamp` المخزّن (**UTC**)
  والعرض بتوقيت القاهرة (UTC+3) — فرق التلات ساعات ممكن يحط عملية بعد ٩ مساءً
  في يوم UTC اللي بعده. مقبول لفلتر بالأيام، ومكتوب هنا عشان مايتكتشفش كباج.
- صفوف السجل اللي اتكتبت **قبل v3.2** مالهاش `extra.result`، وعمود "النتيجة"
  بيعرضها **"—" مش "✓"** — إحنا فعليًا مش عارفين إن كان الفعل تم بالكامل وقتها.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (1.1.html · 3.0.html · 3.0.1.html · 3.0.3.html · 3.1.html) محفوظة في commit: 3a2c551
git show 3a2c551^:1.1.html
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v2.0.0 |
| ecommoda-html-builder | v6.3.0 |
| ecommoda-constants | v1.4.3 |
| ecommoda-order-lifecycle | v1.2.0 |
| shopify-graphql-helper | v1.0.0 |
| bosta-api-helper | — (خارج نظام الإصدارات — مفيش سطر إصدار في المهارة) |

آخر مطابقة: 03-09-2026 · `index.js` v3.2.0 · `index.html` v3.2
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- Build watch paths لسه `*` الافتراضي — تضييقها لـ `index.js` + `wrangler.toml` قرار داشبورد لأحمد (§13-ب في السكيل).
- خط الأساس الحي (بند ١٠) — يتقفل بأول سكان فعلي بعد النقل، راجع "خط الأساس بعد النقل" فوق.
- الـ CORS لسه `wildcard *` رغم إن الأداة بقت بتكتب على شوبيفاي (ميتافيلد +
  فلفلمنت). القرار متسجّل فوق على إنها "مش أداة مالية ولا كتابة على مخزون" —
  لو ده اتغيّر، التحويل لـ Option B (allowlist) قرار لأحمد مش تعديل روتيني.
- `ADMIN_WORKER_URL` في `§CONFIG` اتكتب من `ecommoda-constants` §5b — لو القيمة
  دي مختلفة عندك، عدّلها هناك في الكود (مش في شاشة الإعدادات، الحقل اتشال).

### 🟡 سؤال مفتوح لأحمد — "سبب تغيير الحالة" على S1

`ecommoda-order-lifecycle` §1.5 بيقول إن **أي Worker بيكتب `custom.manual_status`
لازم يطلب سبب** (إلزامي في الواجهة + رفض `400` من السيرفر). الأداة دي بتكتب
`S1 = Shipped`، فظاهريًا داخلة في النطاق.

**قراءتنا (ولذلك ما اتنفّذش):** نص البند نفسه بيقول
«Today only **Order Status Updater** writes S1 **manually**» — والقاعدة معناها
"لما موظف **يختار** حالة، سجّل ليه". هنا الموظف مابيختارش حالة أصلاً: الأداة
بتشتق الانتقال الوحيد المسموح من نوع الشحنة في بوسطة + الحالة الحالية على
شوبيفاي، والسبب هو **حدث السكان نفسه**. وإضافة حقل سبب إلزامي على كل سكان
هتبطّأ نقطة الشحن من غير معلومة جديدة.

⚠️ **القرار ده لأحمد مش لجلسة كود.** لو الإجابة "لأ، الأداة دي مستثناة" →
يتكتب استثناء صريح في `§1.5`. لو "أيوة مطلوب" → الشغل: حقل سبب في شاشة
النتائج + رفض `400` في `handleUpdate` + `extra.reasonSource` في D1.
**ممنوع** أي جلسة جاية تنفّذها أو تلغيها من نفسها وسط مهمة تانية.

## بعد نشر v3.2 — تأكيدات مطلوبة

1. **Promote** بعد أول build للـ Worker، وبعدها افتح الأداة واضغط 🩺 في
   الإعدادات — لازم كل الفحوصات ✅ (خصوصًا صلاحيات شوبيفاي والفلفلمنت).
2. لو بادج **⚠️ الـ Worker نسخة قديمة** ظهر في الهيدر → الـ Promote ما تمّش.
3. أول سكان فعلي: اتأكد إن الصف اللي فلفلمنته فشل بيبان **أصفر** مش أخضر.

آخر تحديث: 03-09-2026 — 14:20

</div>

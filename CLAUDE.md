# سكانر شحن الأوردرات من بوسطة (`Bosta-Orders-Shipped-Scanner`)

**بتعمل إيه:** الموظف بيسكان تراكينج نمرة بوسطة، الأداة بتتأكد من نوع الشحنة وحالتها الحالية على شوبيفاي (S1/S2)، ولو الانتقال صحيح بتكتب الحالة `Shipped` وتعمل Fulfillment تلقائي.
**مين بيستخدمها:** المخزن — نقطة الشحن.
**الإصدار:** Worker `v3.1.0` · الواجهة `v3.1`

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
| `get_logs` | سجل العمليات |
| `get_logs_count` | عدد الصفوف المطابقة للفلاتر |
| `get_logs_export` | تصدير كامل (حد أقصى 2000 صف) |

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
  بيتسجل كـ warning في `extra.fulfillment` مش كفشل كامل للصف.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (1.1.html · 3.0.html · 3.0.1.html · 3.0.3.html) محفوظة في commit: <يُستكمل في PR #2>
git show <sha>:1.1.html
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-tool-migration-playbook | مرجع النقل نفسه |
| ecommoda-constants | v1.4.3 |

آخر مطابقة: 03-09-2026 · `index.js` v3.1.0 · `index.html` v3.1
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- Build watch paths لسه `*` الافتراضي — تضييقها لـ `index.js` + `wrangler.toml` قرار داشبورد لأحمد (§13-ب في السكيل).
- خط الأساس الحي (بند ١٠) — يتقفل بأول سكان فعلي بعد النقل، راجع "خط الأساس بعد النقل" فوق.

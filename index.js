// bosta-orders-shipped-scanner — Cloudflare Worker
// Account : ecommoda-dev (Ecommoda.dev@gmail.com)
// Auth/D1 tool value : bosta_tracker | Types: login / logout  (unchanged — Universal D1 Auth)
// Status-write log    : tool = metafields_change | type = update
//                       (extra.sourceTool = "bosta_orders_shipped_scanner" — see §CONSTANTS)
//
// v3.1.0 — إضافة Fulfill تلقائي بعد كتابة Shipped (S1 أو S2):
//   بعد نجاح metafieldsSet لأي أوردر، لو عنده fulfillmentOrders بحالة OPEN
//   بيتعمل عليهم fulfillmentCreate في نفس الخطوة (نفس الـ pattern المعتمد في
//   Order Status Updater — راجع §SHOPIFY::createFulfillment). الترتيب: كتابة
//   الميتافيلد أولاً ثم الفلفلمنت — لو الفلفلمنت فشل، حالة S1/S2 على شوبيفاي
//   تفضل مكتوبة بنجاح (مش بترجع/rollback) والفشل بيتسجل كـ warning منفصل في
//   النتيجة + في extra.fulfillment بالـ D1 log، مش كفشل كامل للصف.
//   لو مفيش fulfillmentOrders بحالة OPEN (الأوردر متعمله fulfill من قبل —
//   مثلاً إعادة شحن) بيتم تجاهل الخطوة دي بصمت وتكمل كتابة الميتافيلد عادي.
// v3.0.3 — إصلاح mutation: Metafield.owner بدل ownerId غير الموجود
// v3.0.2 — إظهار أخطاء GraphQL الحقيقية + ضم السجل القديم (tagged) لتاب السجل
// v3.0.1 — إصلاح مطابقة businessReference (راجع §HELPERS::cleanOrderName)
// v2.0.0 — تحديث شامل: استبدال tagsAdd بتحديث ميتافيلد S1/S2 مباشرة + فحص
// الحالة الحالية على شوبيفاي قبل عرض الأوردر كقابل للتحديث (راجع
// ecommoda-order-lifecycle skill — رول 10: أي كتابة manual_status/status_2_r_e
// لازم تتحقق من الـ transition الأول).
//
// Endpoints:
//   ?action=check_employee   GET
//   ?action=register_pin     POST
//   ?action=verify_employee  POST
//   ?action=log_logout       GET
//   ?action=get_employees    GET
//   ?action=lookup           POST  — Bosta search + Shopify S1/S2 batch check + transition validation
//   ?action=update           POST  — إعادة تحقق من الحالة وقت الكتابة + metafieldsSet
//                                    + fulfillmentCreate (لو فيه OPEN fulfillmentOrders) + D1 log
//   ?action=get_logs         GET  — server-side search + pagination (metafields_change فقط لهذه الأداة)
//   ?action=get_logs_count   GET  — total count matching filters
//   ?action=get_logs_export  GET  — full export, limit 2000, no pagination

// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 'bosta_tracker';                    // login/logout D1 logging only
const SOURCE_TOOL     = 'bosta_orders_shipped_scanner';     // tag used in extra.sourceTool for status-write logs
const SOURCE_TOOL_LIKE = `%"sourceTool":"${SOURCE_TOOL}"%`;
const BOSTA_API_BASE = 'https://app.bosta.co/api/v2';

// §CONSTANTS::status — verbatim strings from ecommoda-order-lifecycle (casing is load-bearing)
const S1_STATUS = {
  NEW_ORDER:      'New Order',
  CONFIRMED:      'Confirmed',
  WA_CONFIRMED:   'WhatsApp-Confirmed',
  WA_CANCELLED:   'WhatsApp-CANCELLED',
  CONFIRMED_EDIT: 'Confirmed + Edit',
  PENDING_EDIT:   'Pending Edit',
  READY:          'Ready',
  SHIPPED:        'Shipped',
  IN_RETURN:      'In-Return',
  DELIVERED:      'Delivered',
  RETURNED:       'Returned',
  CANCELLED:      'Cancelled',
};

const S2_STATUS = {
  CONFIRMED_RETURN:   'Confirmed + RETURN',
  CONFIRMED_EXCHANGE: 'Confirmed + EXCHANGE',
  READY:              'Ready',
  SHIPPED:            'Shipped',
  IN_RETURN:          'In-Return',
  RETURNED:           'Returned',
};

// ── CORS (Option A — Wildcard: Bosta/read tool) ───────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
function getCORS(_req) { return CORS_HEADERS; }

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': '*' });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::cleanOrderName ───
// المفتاح الموحّد لأي اسم أوردر داخل هذا الـ Worker: بدون '#' وبدون مسافات.
// ⚠️ Bosta بيرجّع businessReference بالـ '#' (معيار إلزامي — راجع bosta-api-helper)،
// فأي مطابقة بين قيمة جاية من بوسطة ومفتاح ماب مبني من أسماء أوردرات لازم تعدّي
// من هنا. عدم استخدامها هو اللي سبّب باج v2.0.0 (كل الأوردرات كانت تُرفض بـ
// "الأوردر غير موجود على شوبيفاي" لأن المفتاح كان "#51154" والماب فيه "51154").
function cleanOrderName(v) {
  return String(v ?? '').replace(/^#/, '').trim();
}

// ══════════════════════════════════════════════════════════════
// §SHARED: Auth & Logging Functions — EcomModa D1 Pattern v1.2.0
// Copy this block VERBATIM into every Worker — no modifications
// ══════════════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return { exists: true, hasPin: !!row.pin, isActive: !!row.is_active };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

async function getLogs(db, {
  tool     = null,
  employee = null,
  type     = null,
  search   = null,
  limit    = 200,
  offset   = 0,
} = {}) {
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type)     { sql += ' AND type = ?';     b.push(type); }
  if (search) {
    sql += ' AND (sku LIKE ? OR product_title LIKE ? OR order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  b.push(Math.min(limit, 500), offset);

  return (await db.prepare(sql).bind(...b).all()).results;
}

// ══════════════════════════════════════════════════════════════
// END §SHARED BLOCK
// ══════════════════════════════════════════════════════════════

// ── §LOG-ENDPOINTS helpers — this tool's writes live under tool='metafields_change' ──
// Filtered by extra.sourceTool so this tool's log tab shows only its own entries,
// even though other EcomModa tools write to the same 'metafields_change' bucket.
//
// ⚠️ السجل التاريخي: قبل v2.0.0 كانت الأداة بتسجل تحت tool='bosta_tracker'
// و type='tagged' (نظام التاجات القديم). الشرط تحت بيضم النوعين مع بعض عشان
// السجل القديم يفضل ظاهر بعد التحديث — من غيره تاب السجل بيبان فاضي تمامًا.
const LOG_SCOPE_SQL = `(
     (tool = 'metafields_change' AND type = 'update' AND extra LIKE ?)
  OR (tool = 'bosta_tracker'     AND type = 'tagged')
)`;

async function getLogsCount(db, { employee = null, search = null } = {}) {
  let sql = `SELECT COUNT(*) as total FROM logs WHERE ${LOG_SCOPE_SQL}`;
  const b = [SOURCE_TOOL_LIKE];

  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

async function getLogsExport(db, { employee = null, search = null } = {}) {
  let sql = `SELECT * FROM logs WHERE ${LOG_SCOPE_SQL}`;
  const b = [SOURCE_TOOL_LIKE];

  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT 2000';

  return (await db.prepare(sql).bind(...b).all()).results;
}

// ══════════════════════════════════════════════════════════════
// §BOSTA
// ══════════════════════════════════════════════════════════════

const STATE_MAP = {
  10:  'Pickup requested',
  11:  'Waiting for route',
  20:  'Route Assigned',
  21:  'Picked up from business',
  22:  'Picking up from consignee',
  23:  'Picked up from consignee',
  24:  'Received at warehouse',
  25:  'Fulfilled',
  30:  'In transit between Hubs',
  40:  'Picking up',
  41:  'Picked up',
  45:  'Delivered',
  46:  'Returned to business',
  47:  'Exception',
  48:  'Terminated',
  49:  'Canceled',
  60:  'Returned to stock',
  100: 'Lost',
  101: 'Damaged',
  102: 'Investigation',
  103: 'Awaiting your action',
  104: 'Archived',
  105: 'On hold',
};

function extractDeliveries(raw) {
  if (Array.isArray(raw?.data?.deliveries)) return raw.data.deliveries;
  if (Array.isArray(raw?.data))             return raw.data;
  if (Array.isArray(raw?.deliveries))       return raw.deliveries;
  if (raw?.trackingNumber)                  return [raw];
  return [];
}

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════

async function getAccessToken(env) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body:    JSON.stringify({ query, variables }),
  });
  return resp.json();
}

// ─── §SHOPIFY::fetchShopifyOrdersByNames ───
// Batches multiple `orders(query: name:#X)` lookups into ONE GraphQL call via
// aliases (o0, o1, ...) — up to 20 per call — instead of one round trip per order.
// Also pulls fulfillmentOrders(status) — needed by handleUpdate to fulfill the
// order right after writing Shipped (see §SHOPIFY::createFulfillment). Fetched
// here too (not just in handleUpdate) because handleUpdate re-fetches fresh
// state via this same function right before writing — no separate query needed.
// Returns { [cleanOrderName]: { orderId, orderGid, orderName, s1, s2, fulfillmentOrders } | null }
async function fetchShopifyOrdersByNames(env, token, orderNames) {
  const clean = [...new Set(
    orderNames.map(cleanOrderName).filter(Boolean)
  )];
  if (!clean.length) return {};

  const CHUNK = 20;
  const map = {};

  for (let i = 0; i < clean.length; i += CHUNK) {
    const chunk = clean.slice(i, i + CHUNK);
    const aliasBlocks = chunk.map((name, idx) => {
      const safe = name.replace(/[^a-zA-Z0-9\-]/g, ''); // sanitize before string-interpolating into query
      return `o${idx}: orders(first: 1, query: "name:#${safe}") {
        edges { node {
          id
          legacyResourceId
          name
          s1: metafield(namespace: "custom", key: "manual_status") { value }
          s2: metafield(namespace: "custom", key: "status_2_r_e") { value }
          fulfillmentOrders(first: 20) { nodes { id status } }
        } }
      }`;
    }).join('\n');

    const resp = await shopifyGQL(env, token, `query { ${aliasBlocks} }`);
    const data = resp?.data || {};

    chunk.forEach((name, idx) => {
      const node = data[`o${idx}`]?.edges?.[0]?.node || null;
      map[name] = node ? {
        orderId:   node.legacyResourceId, // numeric — required for orderLink() on frontend
        orderGid:  node.id,
        orderName: node.name,
        s1:        node.s1?.value || null,
        s2:        node.s2?.value || null,
        fulfillmentOrders: (node.fulfillmentOrders?.nodes || []),
      } : null;
    });
  }

  return map;
}

// ─── §SHOPIFY::validateTransition ───
// The single rule this tool enforces (confirmed by Ahmed):
//   Bosta orderType = "Send"   → requires S1 = Ready       → writes S1 = Shipped
//   Bosta orderType = anything else → requires S1 = Delivered AND S2 = Ready
//                                    → writes S2 = Shipped
// Any other current state is rejected — never written silently (order-lifecycle Rule 10).
function validateTransition(orderType, sOrder) {
  const isSend = String(orderType || '').trim().toLowerCase() === 'send';

  if (isSend) {
    if (sOrder.s1 === S1_STATUS.READY) {
      return { valid: true, machine: 'S1', targetField: 'custom.manual_status', targetValue: S1_STATUS.SHIPPED };
    }
    return { valid: false, reason: `S1 ليس Ready (الحالي: ${sOrder.s1 || '—'})` };
  }

  if (sOrder.s1 === S1_STATUS.DELIVERED && sOrder.s2 === S2_STATUS.READY) {
    return { valid: true, machine: 'S2', targetField: 'custom.status_2_r_e', targetValue: S2_STATUS.SHIPPED };
  }
  if (sOrder.s1 !== S1_STATUS.DELIVERED) {
    return { valid: false, reason: `S1 ليس Delivered (الحالي: ${sOrder.s1 || '—'})` };
  }
  return { valid: false, reason: `S2 ليس Ready (الحالي: ${sOrder.s2 || '—'})` };
}

// ─── §SHOPIFY::metafieldsSetBatch ───
// Batches metafield writes across multiple orders into chunks of 25 (Shopify
// metafieldsSet accepts multiple owners in one mutation). Matching success/failure
// back to each input is done by `${ownerId}::${key}` — not by userErrors field
// index, because that index resets per-chunk and would misalign across chunks.
//
// ⚠️ النوع `Metafield` **مفيهوش** حقل اسمه `ownerId` — ده كان بيرمي
// `Field 'ownerId' doesn't exist on type 'Metafield'` وبيفشل كل الكتابات.
// الحقل الصحيح هو `owner` (interface HasMetafields) وبنستخرج منه الـ ID
// بـ inline fragment على Order.
const METAFIELDS_SET_MUTATION = `
  mutation setMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        value
        owner { ... on Order { id } }
      }
      userErrors { field message }
    }
  }
`;

async function metafieldsSetBatch(env, token, metafieldInputs) {
  const CHUNK = 25;
  const successSet = new Set();
  const errorsList = [];

  for (let i = 0; i < metafieldInputs.length; i += CHUNK) {
    const chunk = metafieldInputs.slice(i, i + CHUNK);
    const resp  = await shopifyGQL(env, token, METAFIELDS_SET_MUTATION, { metafields: chunk });
    const result = resp?.data?.metafieldsSet;

    // ⚠️ لو فيه top-level GraphQL errors (صلاحيات، throttle، حقل غلط) الـ data
    // بترجع null والـ userErrors فاضية — من غير التقاطها هنا الرسالة الحقيقية
    // بتضيع وبيظهر بدلها "فشل تحديث الميتافيلد" العام اللي مش بيفيد في التشخيص.
    if (Array.isArray(resp?.errors) && resp.errors.length) {
      for (const e of resp.errors) {
        errorsList.push({ field: null, message: `GraphQL: ${e.message}` });
      }
    } else if (!result) {
      errorsList.push({ field: null, message: 'رد غير متوقع من شوبيفاي (metafieldsSet فاضي)' });
    }

    for (const m of (result?.metafields || [])) {
      const ownerId = m?.owner?.id;           // ← owner.id مش ownerId
      if (ownerId) successSet.add(`${ownerId}::${m.key}`);
    }
    for (const e of (result?.userErrors || [])) errorsList.push(e);
  }

  return { successSet, errorsList };
}

// ─── §SHOPIFY::createFulfillment ───
// ONE call covering every OPEN fulfillmentOrder on a single order. Same pattern
// confirmed working in Order Status Updater (fulfillmentCreate — not the
// deprecated fulfillmentCreateV2). notifyCustomer:false — warehouse-internal
// action, no customer-facing email wanted here.
// ⚠️ Called AFTER the metafield write succeeds, never before — if this throws,
// the S1/S2 status already written stays written (not rolled back). The caller
// (handleUpdate) catches this separately and reports it as a fulfillment
// warning on an otherwise-successful row, not as a failed status update.
const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

async function createFulfillment(env, token, openFulfillmentOrders) {
  if (!openFulfillmentOrders.length) return 0;

  const resp = await shopifyGQL(env, token, FULFILLMENT_CREATE_MUTATION, {
    fulfillment: {
      notifyCustomer: false,
      lineItemsByFulfillmentOrder: openFulfillmentOrders.map(fo => ({ fulfillmentOrderId: fo.id })),
    },
  });

  if (Array.isArray(resp?.errors) && resp.errors.length) {
    throw new Error(`GraphQL: ${resp.errors.map(e => e.message).join(' | ')}`);
  }
  const errs = resp?.data?.fulfillmentCreate?.userErrors || [];
  if (errs.length) throw new Error('fulfillmentCreate: ' + errs.map(e => e.message).join(' | '));
  return openFulfillmentOrders.length;
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // 1. CORS Preflight — always first
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    // 2. WORKER_SECRET check — always second
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: getCORS(request),
      });

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      // ─── §AUTH ──────────────────────────────────────────────────────────

      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);
        await writeLog(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }

      // ─── §LOOKUP / §UPDATE ──────────────────────────────────────────────

      if (action === 'lookup') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return handleLookup(request, env);
      }

      if (action === 'update') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return handleUpdate(request, env);
      }

      // ─── §LOG-ENDPOINTS ─────────────────────────────────────────────────

      // get_logs — server-side search + pagination. Only this tool's writes
      // (tool='metafields_change' AND extra.sourceTool = SOURCE_TOOL). login/logout excluded by design.
      if (action === 'get_logs') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const limit    = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 100);
        const offset   = Math.max(parseInt(url.searchParams.get('offset') || '0'),    0);

        let sql = `SELECT * FROM logs WHERE ${LOG_SCOPE_SQL}`;
        const b = [SOURCE_TOOL_LIKE];

        if (employee) { sql += ' AND employee = ?'; b.push(employee); }
        if (search) {
          sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
          b.push(`%${search}%`, `%${search}%`);
        }

        sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        b.push(limit, offset);

        const entries = (await env.DB.prepare(sql).bind(...b).all()).results;
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const total    = await getLogsCount(env.DB, { employee, search });
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const entries  = await getLogsExport(env.DB, { employee, search });
        return json({ ok: true, entries }, 200, request);
      }

      return json({ error: 'Unknown action' }, 404, request);
    } catch (err) {
      return json({ error: err.message }, 500, request);
    }
  },
};

// ─── §LOOKUP::handleLookup ───
// POST body: { trackingNumbers: ["123456", ...] }
// 1) Bosta /deliveries/search — unchanged batching (50/chunk)
// 2) For every found delivery, batch-fetch the matching Shopify order's S1/S2 +
//    numeric orderId via alias-batched GraphQL (fetchShopifyOrdersByNames)
// 3) Validate the S1/S2 transition per order (validateTransition) — orders that
//    don't qualify come back with valid:false + a human-readable rejectReason;
//    they are NOT written, only surfaced for the employee to see why.
async function handleLookup(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { trackingNumbers } = body;
  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0)
    return json({ error: 'trackingNumbers[] مطلوب' }, 400);

  // 1) Bosta lookup
  const CHUNK = 50;
  const allDeliveries = [];

  for (let i = 0; i < trackingNumbers.length; i += CHUNK) {
    const chunk = trackingNumbers.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${BOSTA_API_BASE}/deliveries/search`, {
        method:  'POST',
        headers: { Authorization: env.BOSTA_API_KEY, 'Content-Type': 'application/json' }, // ✅ no "Bearer"
        body: JSON.stringify({ trackingNumbers: chunk.map(String), limit: chunk.length }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      allDeliveries.push(...extractDeliveries(data));
    } catch (_) {}
  }

  const deliveryMap = {};
  for (const d of allDeliveries) {
    const tn = String(d.trackingNumber || '');
    if (tn) deliveryMap[tn] = d;
  }

  const bostaResults = trackingNumbers.map(tn => {
    const d = deliveryMap[String(tn)];
    if (!d) {
      return { trackingNumber: String(tn), businessRef: null, orderType: null, state: null, stateCode: null, found: false };
    }
    const orderType = String(d.type?.value || d.type || '');
    return {
      trackingNumber: String(tn),
      businessRef:    String(d.businessReference || ''),
      orderType,
      state:          STATE_MAP[d.state?.code] || d.state?.value || '', // ✅ STATE_MAP[code] — never state.value
      stateCode:      d.state?.code ?? null,
      found:          true,
    };
  });

  // 2) Shopify batch check — only for orders Bosta actually found
  const foundRefs = [...new Set(bostaResults.filter(r => r.found && r.businessRef).map(r => r.businessRef))];

  let shopifyMap = {};
  let shopifyError = null;
  if (foundRefs.length) {
    try {
      const token = await getAccessToken(env);
      shopifyMap = await fetchShopifyOrdersByNames(env, token, foundRefs);
    } catch (err) {
      shopifyError = err.message;
    }
  }

  // 3) Merge + validate
  const results = bostaResults.map(r => {
    if (!r.found) {
      return { ...r, orderId: null, s1: null, s2: null, valid: false, rejectReason: null, targetField: null, targetValue: null, machine: null };
    }

    if (shopifyError) {
      return { ...r, orderId: null, s1: null, s2: null, valid: false, rejectReason: `تعذر الاتصال بشوبيفاي: ${shopifyError}`, targetField: null, targetValue: null, machine: null };
    }

    // ⚠️ مفتاح الماب منظّف (بدون '#') — و r.businessRef جاي من بوسطة بالـ '#'.
    // لازم cleanOrderName() هنا وإلا كل أوردر هيترفض بـ "غير موجود على شوبيفاي".
    const sOrder = shopifyMap[cleanOrderName(r.businessRef)];
    if (!sOrder) {
      return { ...r, orderId: null, s1: null, s2: null, valid: false, rejectReason: 'الأوردر غير موجود على شوبيفاي', targetField: null, targetValue: null, machine: null };
    }

    const v = validateTransition(r.orderType, sOrder);
    return {
      ...r,
      orderId:      sOrder.orderId,
      s1:           sOrder.s1,
      s2:           sOrder.s2,
      valid:        v.valid,
      rejectReason: v.valid ? null : v.reason,
      targetField:  v.valid ? v.targetField : null,
      targetValue:  v.valid ? v.targetValue : null,
      machine:      v.valid ? v.machine : null,
    };
  });

  return json({ ok: true, results });
}

// ─── §UPDATE::handleUpdate ───
// POST body: { employee, items: [{ orderName, trackingNumber, orderType }] }
// Re-fetches current S1/S2 right before writing (defense against state that
// changed between lookup and this click — e.g. another employee already advanced
// it) and re-runs validateTransition. Only orders still valid get written.
// After a successful metafieldsSet, also runs fulfillmentCreate on every OPEN
// fulfillmentOrder for that order (see §UPDATE::fulfillAfterWrite below) — the
// order is now genuinely leaving the warehouse, so it should leave Unfulfilled
// on Shopify too. A fulfillment failure does not undo the status write; it's
// reported per-row as a separate warning.
async function handleUpdate(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { items, employee } = body;
  if (!Array.isArray(items) || items.length === 0)
    return json({ error: 'items[] مطلوب' }, 400);

  let token;
  try { token = await getAccessToken(env); }
  catch (err) { return json({ error: `Token error: ${err.message}` }, 500); }

  const orderNames = items.map(it => it.orderName);
  let freshMap;
  try {
    freshMap = await fetchShopifyOrdersByNames(env, token, orderNames);
  } catch (err) {
    return json({ error: `Shopify lookup failed: ${err.message}` }, 500);
  }

  const results       = [];
  const toWrite        = []; // metafieldsSet inputs
  const perOrderMeta   = {}; // `${ownerId}::${key}` -> context needed for D1 log + result row

  for (const item of items) {
    const cleanName = cleanOrderName(item.orderName);

    if (!cleanName) {
      results.push({ orderName: item.orderName, success: false, error: 'Missing orderName' });
      continue;
    }

    const sOrder = freshMap[cleanName];
    if (!sOrder) {
      results.push({ orderName: item.orderName, success: false, error: 'الأوردر غير موجود على شوبيفاي' });
      continue;
    }

    const v = validateTransition(item.orderType, sOrder);
    if (!v.valid) {
      results.push({ orderName: item.orderName, success: false, error: `الحالة تغيرت قبل التحديث — ${v.reason}` });
      continue;
    }

    const key      = v.targetField.split('.')[1]; // 'manual_status' | 'status_2_r_e'
    const metaKey  = `${sOrder.orderGid}::${key}`;
    const valueBefore = v.machine === 'S1' ? sOrder.s1 : sOrder.s2;

    toWrite.push({
      ownerId:   sOrder.orderGid,
      namespace: 'custom',
      key,
      type:      'single_line_text_field', // both status fields — confirmed in ecommoda-order-lifecycle skill
      value:     v.targetValue,
    });

    perOrderMeta[metaKey] = {
      orderName:      `#${cleanName}`,
      orderId:        sOrder.orderId,
      orderGid:       sOrder.orderGid,
      trackingNumber: String(item.trackingNumber || ''),
      orderType:      item.orderType || '',
      machine:        v.machine,
      field:          v.targetField,
      valueBefore,
      valueAfter:     v.targetValue,
      // Both write-paths in this tool (S1=Shipped for "Send", S2=Shipped for
      // Return/Exchange re-dispatch) target the same label "Shipped" — so
      // fulfillment is attempted after EVERY successful write here, not
      // conditioned on machine.
      openFulfillmentOrders: (sOrder.fulfillmentOrders || []).filter(fo => fo.status === 'OPEN'),
    };
  }

  if (toWrite.length) {
    let batchResult;
    try {
      batchResult = await metafieldsSetBatch(env, token, toWrite);
    } catch (err) {
      for (const w of toWrite) {
        const meta = perOrderMeta[`${w.ownerId}::${w.key}`];
        results.push({ orderName: meta.orderName, success: false, error: `Shopify error: ${err.message}` });
      }
      batchResult = null;
    }

    if (batchResult) {
      const { successSet, errorsList } = batchResult;
      for (const w of toWrite) {
        const metaKey = `${w.ownerId}::${w.key}`;
        const meta    = perOrderMeta[metaKey];

        if (successSet.has(metaKey)) {
          // ─── §UPDATE::fulfillAfterWrite ───
          // Metafield already written successfully at this point. Fulfillment
          // is best-effort on top of it — a failure here is reported as a
          // warning on the row, never as a rollback of the status write.
          const fulfillment = { attempted: false, created: 0, error: null };
          if (meta.openFulfillmentOrders.length) {
            fulfillment.attempted = true;
            try {
              fulfillment.created = await createFulfillment(env, token, meta.openFulfillmentOrders);
            } catch (err) {
              fulfillment.error = err.message;
            }
          }

          await writeLog(env.DB, {
            tool:        'metafields_change',
            type:        'update',
            employee:    employee || null,
            orderId:     meta.orderId,
            orderName:   meta.orderName,
            valueBefore: meta.valueBefore,
            valueAfter:  meta.valueAfter,
            notes:       `${meta.machine}: ${meta.valueBefore || '—'} → ${meta.valueAfter}`
                         + (fulfillment.error ? ` · فلفلمنت فشل: ${fulfillment.error}` : ''),
            extra: {
              sourceTool:     SOURCE_TOOL,
              trackingNumber: meta.trackingNumber,
              orderType:      meta.orderType,
              machine:        meta.machine,
              field:          meta.field,
              fulfillment,
            },
          });
          results.push({
            orderName:   meta.orderName,
            success:     true,
            orderId:     meta.orderId,
            field:       meta.field,
            valueBefore: meta.valueBefore,
            valueAfter:  meta.valueAfter,
            fulfillment,
          });
        } else {
          const errMsg = errorsList.length ? errorsList[0].message : 'فشل تحديث الميتافيلد';
          results.push({ orderName: meta.orderName, success: false, error: errMsg });
        }
      }
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return json({
    ok: true,
    results,
    summary: { total: items.length, succeeded, failed: items.length - succeeded },
  });
}

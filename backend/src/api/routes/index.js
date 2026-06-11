// src/api/routes/index.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { mysqlPool } = require('../../../config/database');
const influxService = require('../../services/influx.service');
const { authMiddleware, requireRole, scopeToClient } = require('../middleware/auth');
const { checkHeartbeats } = require('../../rules/heartbeat');

const sseService = require('../../services/sse.service');

// Auto-wrap async handlers para Express 4 (que não captura rejeições de promises)
const router = (() => {
  const r = express.Router();
  ['get', 'post', 'put', 'delete', 'patch'].forEach(method => {
    const orig = r[method].bind(r);
    r[method] = (path, ...fns) => orig(path, ...fns.map(fn =>
      fn && fn.constructor && fn.constructor.name === 'AsyncFunction'
        ? (req, res, next) => fn(req, res, next).catch(next)
        : fn
    ));
  });
  return r;
})();

const auth = authMiddleware;

// ============================================================
// ESCOPO MULTI-TENANT
// superadmin acessa tudo; admin/viewer só recursos do próprio client_id.
// Responde 404 (e não 403) para não revelar a existência do recurso.
// ============================================================

async function cpdInScope(req, cpdId) {
  if (req.user.role === 'superadmin') return true;
  const [r] = await mysqlPool.query(
    'SELECT 1 FROM cpds WHERE id = ? AND client_id = ?',
    [cpdId, req.user.client_id],
  );
  return r.length > 0;
}

async function deviceInScope(req, deviceId) {
  if (req.user.role === 'superadmin') return true;
  const [r] = await mysqlPool.query(
    `SELECT 1 FROM devices d JOIN cpds c ON c.id = d.cpd_id
     WHERE d.id = ? AND c.client_id = ?`,
    [deviceId, req.user.client_id],
  );
  return r.length > 0;
}

async function contactInScope(req, contactId) {
  if (req.user.role === 'superadmin') return true;
  const [r] = await mysqlPool.query(
    'SELECT 1 FROM contacts WHERE id = ? AND client_id = ?',
    [contactId, req.user.client_id],
  );
  return r.length > 0;
}

const notFound = (res) => res.status(404).json({ error: 'Recurso não encontrado' });

// Sanitização: IDs de rota usados em queries Flux (string interpolation)
// precisam ser estritamente numéricos.
const isId = (v) => /^\d+$/.test(String(v));

// parseInt com default e limites — evita NaN/abuso em LIMIT
function intParam(v, def, min, max) {
  const n = parseInt(v);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// ============================================================
// AUTH
// ============================================================

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email e password obrigatórios' });

  const [rows] = await mysqlPool.query(
    'SELECT id, password_hash, role, client_id, active FROM users WHERE email = ?',
    [email],
  );
  const user = rows[0];
  if (!user || !user.active)
    return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Credenciais inválidas' });

  await mysqlPool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  const token = jwt.sign(
    { sub: user.id, role: user.role, client_id: user.client_id },
    process.env.JWT_SECRET,
    { expiresIn: '12h' },
  );
  res.json({ token, role: user.role, client_id: user.client_id });
});

// ============================================================
// CLIENTS (superadmin)
// ============================================================

router.get('/clients', auth, requireRole('superadmin'), async (req, res) => {
  const [rows] = await mysqlPool.query(
    'SELECT id, name, document, email, plan, active, created_at FROM clients ORDER BY name',
  );
  res.json(rows);
});

router.post('/clients', auth, requireRole('superadmin'), async (req, res) => {
  const { name, document, email, phone, plan,
    default_temp_max, default_temp_min, default_humidity_max, default_humidity_min } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  const [result] = await mysqlPool.query(
    `INSERT INTO clients (name, document, email, phone, plan,
       default_temp_max, default_temp_min, default_humidity_max, default_humidity_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, document || null, email || null, phone || null, plan || 'standard',
     default_temp_max ?? 27, default_temp_min ?? 16,
     default_humidity_max ?? 70, default_humidity_min ?? 30],
  );
  res.status(201).json({ id: result.insertId });
});

router.put('/clients/:id', auth, requireRole('superadmin'), async (req, res) => {
  const fields = ['name','document','email','phone','plan','active',
    'default_temp_max','default_temp_min','default_humidity_max','default_humidity_min',
    'default_severity_warning_delta','default_severity_critical_delta'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => fields.includes(k)),
  );
  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await mysqlPool.query(
    `UPDATE clients SET ${set} WHERE id = ?`,
    [...Object.values(updates), req.params.id],
  );
  res.json({ ok: true });
});

router.delete('/clients/:id', auth, requireRole('superadmin'), async (req, res) => {
  await mysqlPool.query('UPDATE clients SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
// CPDs
// ============================================================

router.get('/cpds', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope;
  const where    = clientId ? 'WHERE c.client_id = ?' : '';
  const params   = clientId ? [clientId] : [];
  const [rows] = await mysqlPool.query(
    `SELECT c.*, cl.name AS client_name FROM cpds c
     JOIN clients cl ON cl.id = c.client_id
     ${where} ORDER BY cl.name, c.name`,
    params,
  );
  res.json(rows);
});

router.get('/cpds/:id', auth, scopeToClient, async (req, res) => {
  const [rows] = await mysqlPool.query(
    `SELECT c.*, cl.name AS client_name FROM cpds c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.id = ? ${req.clientScope ? 'AND c.client_id = ?' : ''}`,
    req.clientScope ? [req.params.id, req.clientScope] : [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'CPD não encontrado' });
  res.json(rows[0]);
});

router.put('/cpds/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await cpdInScope(req, req.params.id)) return notFound(res);
  const fields = ['name','location','timezone','active',
    'temp_max','temp_min','humidity_max','humidity_min',
    'heartbeat_interval_sec','heartbeat_timeout_sec',
    'severity_warning_delta','severity_critical_delta'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => fields.includes(k)),
  );
  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await mysqlPool.query(
    `UPDATE cpds SET ${set} WHERE id = ?`,
    [...Object.values(updates), req.params.id],
  );
  res.json({ ok: true });
});

router.delete('/cpds/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await cpdInScope(req, req.params.id)) return notFound(res);
  await mysqlPool.query('UPDATE cpds SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/cpds', auth, requireRole('superadmin','admin'), async (req, res) => {
  const { client_id, name, location, timezone,
    temp_max, temp_min, humidity_max, humidity_min,
    heartbeat_interval_sec, heartbeat_timeout_sec } = req.body;

  // admin só pode criar CPD para seu próprio cliente
  const cid = req.user.role === 'superadmin' ? client_id : req.user.client_id;
  if (!cid || !name) return res.status(400).json({ error: 'client_id e name obrigatórios' });

  const [result] = await mysqlPool.query(
    `INSERT INTO cpds (client_id, name, location, timezone,
       temp_max, temp_min, humidity_max, humidity_min,
       heartbeat_interval_sec, heartbeat_timeout_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cid, name, location || null, timezone || 'America/Sao_Paulo',
     temp_max || null, temp_min || null, humidity_max || null, humidity_min || null,
     heartbeat_interval_sec || 60, heartbeat_timeout_sec || 180],
  );
  res.status(201).json({ id: result.insertId });
});

// ============================================================
// DEVICES
// ============================================================

router.get('/cpds/:cpdId/devices', auth, scopeToClient, async (req, res) => {
  const [rows] = await mysqlPool.query(
    `SELECT d.id, d.name, d.mqtt_client_id, d.firmware_version,
            d.active, d.last_seen_at,
            d.temp_max, d.temp_min, d.humidity_max, d.humidity_min
     FROM devices d
     JOIN cpds c ON c.id = d.cpd_id
     WHERE d.cpd_id = ? ${req.clientScope ? 'AND c.client_id = ?' : ''}`,
    req.clientScope ? [req.params.cpdId, req.clientScope] : [req.params.cpdId],
  );
  res.json(rows);
});

router.get('/devices', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope;
  const [rows] = await mysqlPool.query(
    `SELECT d.id, d.name, d.mqtt_client_id, d.firmware_version,
            d.active, d.last_seen_at, d.cpd_id,
            c.name AS cpd_name, cl.id AS client_id, cl.name AS client_name
     FROM devices d
     JOIN cpds c ON c.id = d.cpd_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE d.active = 1 ${clientId ? 'AND cl.id = ?' : ''}
     ORDER BY cl.name, c.name, d.name`,
    clientId ? [clientId] : [],
  );
  res.json(rows);
});

router.put('/devices/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await deviceInScope(req, req.params.id)) return notFound(res);
  const fields = ['name','active','temp_max','temp_min','humidity_max','humidity_min'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => fields.includes(k)),
  );
  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await mysqlPool.query(
    `UPDATE devices SET ${set} WHERE id = ?`,
    [...Object.values(updates), req.params.id],
  );
  res.json({ ok: true });
});

router.delete('/devices/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await deviceInScope(req, req.params.id)) return notFound(res);
  await mysqlPool.query('UPDATE devices SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/cpds/:cpdId/devices', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await cpdInScope(req, req.params.cpdId)) return notFound(res);
  const crypto = require('crypto');
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  const mqttClientId = `esp32-cpd${req.params.cpdId}-${Date.now()}`;
  const token        = crypto.randomBytes(32).toString('hex');
  const tokenHash    = crypto.createHash('sha256').update(token).digest('hex');

  const [result] = await mysqlPool.query(
    'INSERT INTO devices (cpd_id, name, mqtt_client_id, token) VALUES (?, ?, ?, ?)',
    [req.params.cpdId, name, mqttClientId, tokenHash],
  );

  // Retorna o token em texto puro UMA VEZ — não é armazenado em claro
  res.status(201).json({
    id:             result.insertId,
    mqtt_client_id: mqttClientId,
    token,          // gravar no firmware agora — não será exibido novamente
    note:           'Guarde o token agora. Ele não será exibido novamente.',
  });
});

// ============================================================
// CONTACTS
// ============================================================

router.get('/contacts', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope || req.query.client_id || req.user.client_id;
  const whereClause = clientId ? 'WHERE client_id = ?' : '';
  const params      = clientId ? [clientId] : [];
  const [contacts] = await mysqlPool.query(
    `SELECT * FROM contacts ${whereClause}`,
    params,
  );
  if (!contacts.length) return res.json([]);
  const contactIds = contacts.map(c => c.id);
  const [subs] = await mysqlPool.query(
    `SELECT id, contact_id, cpd_id, alert_type, channel,
            TIME_FORMAT(time_from, '%H:%i') AS time_from,
            TIME_FORMAT(time_to,   '%H:%i') AS time_to,
            weekdays_mask, cooldown_minutes, severity_min, active
     FROM alert_subscriptions
     WHERE contact_id IN (?)`,
    [contactIds],
  );
  const subsByContact = {};
  for (const s of subs) {
    if (!subsByContact[s.contact_id]) subsByContact[s.contact_id] = [];
    subsByContact[s.contact_id].push(s);
  }
  res.json(contacts.map(c => ({ ...c, subscriptions: subsByContact[c.id] || [] })));
});

router.put('/contacts/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await contactInScope(req, req.params.id)) return notFound(res);
  const { name, whatsapp, email, active } = req.body;
  await mysqlPool.query(
    `UPDATE contacts SET
       name = COALESCE(?, name),
       whatsapp = COALESCE(?, whatsapp),
       email = COALESCE(?, email),
       active = COALESCE(?, active)
     WHERE id = ?`,
    [name || null, whatsapp || null, email || null, active ?? null, req.params.id],
  );
  res.json({ ok: true });
});

router.delete('/contacts/:id', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await contactInScope(req, req.params.id)) return notFound(res);
  await mysqlPool.query('UPDATE contacts SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/contacts', auth, requireRole('superadmin','admin'), async (req, res) => {
  const { name, whatsapp, email, subscriptions = [] } = req.body;
  const clientId = req.user.role === 'superadmin'
    ? req.body.client_id
    : req.user.client_id;
  if (!name || !clientId) return res.status(400).json({ error: 'name e client_id obrigatórios' });

  const conn = await mysqlPool.getConnection();
  await conn.beginTransaction();
  try {
    const [result] = await conn.query(
      'INSERT INTO contacts (client_id, name, whatsapp, email) VALUES (?, ?, ?, ?)',
      [clientId, name, whatsapp || null, email || null],
    );
    const contactId = result.insertId;

    for (const sub of subscriptions) {
      await conn.query(
        `INSERT INTO alert_subscriptions
           (contact_id, cpd_id, alert_type, channel, time_from, time_to,
            weekdays_mask, cooldown_minutes, severity_min)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [contactId, sub.cpd_id || null, sub.alert_type || 'all',
         sub.channel || 'whatsapp',
         sub.time_from || '00:00:00', sub.time_to || '23:59:59',
         sub.weekdays_mask ?? 127, sub.cooldown_minutes ?? 30,
         sub.severity_min || 'warning'],
      );
    }
    await conn.commit();
    res.status(201).json({ id: contactId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ============================================================
// ALERT SUBSCRIPTIONS
// ============================================================

router.post('/contacts/:contactId/subscriptions', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await contactInScope(req, req.params.contactId)) return notFound(res);
  const { cpd_id, alert_type, channel, time_from, time_to,
          weekdays_mask, cooldown_minutes, severity_min } = req.body;
  // cpd_id da inscrição (se houver) também precisa pertencer ao cliente
  if (cpd_id && !await cpdInScope(req, cpd_id)) return notFound(res);
  const [result] = await mysqlPool.query(
    `INSERT INTO alert_subscriptions
       (contact_id, cpd_id, alert_type, channel, time_from, time_to,
        weekdays_mask, cooldown_minutes, severity_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.contactId, cpd_id || null, alert_type || 'all',
     channel || 'whatsapp',
     time_from || '00:00:00', time_to || '23:59:59',
     weekdays_mask ?? 127, cooldown_minutes ?? 30,
     severity_min || 'warning'],
  );
  res.status(201).json({
    id: result.insertId,
    contact_id: Number(req.params.contactId),
    cpd_id: cpd_id || null,
    alert_type: alert_type || 'all',
    channel: channel || 'whatsapp',
    time_from: time_from || '00:00:00',
    time_to: time_to || '23:59:59',
    weekdays_mask: weekdays_mask ?? 127,
    cooldown_minutes: cooldown_minutes ?? 30,
    severity_min: severity_min || 'warning',
    active: 1,
  });
});

router.put('/contacts/:contactId/subscriptions/:subId', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await contactInScope(req, req.params.contactId)) return notFound(res);
  const fields = ['cpd_id','alert_type','channel','time_from','time_to','weekdays_mask','cooldown_minutes','severity_min','active'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => fields.includes(k)));
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nenhum campo válido' });
  if (updates.cpd_id && !await cpdInScope(req, updates.cpd_id)) return notFound(res);
  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await mysqlPool.query(
    `UPDATE alert_subscriptions SET ${set} WHERE id = ? AND contact_id = ?`,
    [...Object.values(updates), req.params.subId, req.params.contactId],
  );
  res.json({ ok: true });
});

router.delete('/contacts/:contactId/subscriptions/:subId', auth, requireRole('superadmin','admin'), async (req, res) => {
  if (!await contactInScope(req, req.params.contactId)) return notFound(res);
  await mysqlPool.query(
    'DELETE FROM alert_subscriptions WHERE id = ? AND contact_id = ?',
    [req.params.subId, req.params.contactId],
  );
  res.json({ ok: true });
});

// ============================================================
// LEITURAS E ALERTAS POR DEVICE
// ============================================================

router.get('/devices/:deviceId/readings', auth, scopeToClient, async (req, res) => {
  // deviceId vai interpolado na query Flux: precisa ser numérico e do cliente
  if (!isId(req.params.deviceId)) return notFound(res);
  if (!await deviceInScope(req, req.params.deviceId)) return notFound(res);

  const limit  = intParam(req.query.limit, 60, 1, 1440);
  const { from, to } = req.query;
  const bucket = process.env.INFLUX_BUCKET;
  const { getQueryApi } = require('../../../config/database');
  const queryApi = getQueryApi();

  let timeRange = `range(start: -${limit}m)`;
  if (from && to) {
    const f = new Date(from), t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()))
      return res.status(400).json({ error: 'from/to inválidos' });
    timeRange = `range(start: ${f.toISOString()}, stop: ${t.toISOString()})`;
  }

  const query = `
    from(bucket: "${bucket}")
      |> ${timeRange}
      |> filter(fn: (r) => r._measurement == "sensor_readings")
      |> filter(fn: (r) => r.device_id == "${req.params.deviceId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit})
  `;

  const rows = await new Promise((resolve, reject) => {
    const acc = [];
    queryApi.queryRows(query, {
      next(row, meta) { acc.push(meta.toObject(row)); },
      error(err) { reject(err); },
      complete() { resolve(acc); },
    });
  });
  res.json(rows);
});

router.get('/devices/:deviceId/alerts', auth, scopeToClient, async (req, res) => {
  if (!await deviceInScope(req, req.params.deviceId)) return notFound(res);
  const limit = intParam(req.query.limit, 50, 1, 500);
  const [rows] = await mysqlPool.query(
    `SELECT id, alert_type, severity, value, threshold, message, triggered_at, resolved_at
     FROM alert_events
     WHERE device_id = ?
       ${req.query.open_only === '1' ? 'AND resolved_at IS NULL' : ''}
     ORDER BY triggered_at DESC
     LIMIT ?`,
    [req.params.deviceId, limit],
  );
  res.json(rows);
});

// ============================================================
// LEITURAS (InfluxDB)
// ============================================================

router.get('/cpds/:cpdId/readings', auth, scopeToClient, async (req, res) => {
  if (!isId(req.params.cpdId)) return notFound(res);
  if (!await cpdInScope(req, req.params.cpdId)) return notFound(res);
  const limit = intParam(req.query.limit, 60, 1, 1440);
  const { from, to } = req.query;

  let readings;
  if (from && to) {
    const f = new Date(from), t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()))
      return res.status(400).json({ error: 'from/to inválidos' });
    readings = await influxService.getReadingsByRange(req.params.cpdId, f, t);
  } else {
    readings = await influxService.getLastReadings(req.params.cpdId, limit);
  }
  res.json(readings);
});

// ============================================================
// ALERTAS (histórico)
// ============================================================

router.get('/cpds/:cpdId/alerts', auth, scopeToClient, async (req, res) => {
  if (!await cpdInScope(req, req.params.cpdId)) return notFound(res);
  const limit = intParam(req.query.limit, 50, 1, 500);
  const [rows] = await mysqlPool.query(
    `SELECT id, alert_type, severity, value, threshold, message,
            triggered_at, resolved_at
     FROM alert_events
     WHERE cpd_id = ?
       ${req.query.open_only === '1' ? 'AND resolved_at IS NULL' : ''}
     ORDER BY triggered_at DESC
     LIMIT ?`,
    [req.params.cpdId, limit],
  );
  res.json(rows);
});

// Estatísticas globais para o dashboard
router.get('/stats', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope;
  const scope    = clientId ? 'AND c.client_id = ?' : '';
  const params   = clientId ? [clientId] : [];

  const [[{ total_clients }]] = await mysqlPool.query(
    `SELECT COUNT(*) AS total_clients FROM clients WHERE active = 1 ${clientId ? 'AND id = ?' : ''}`,
    clientId ? [clientId] : [],
  );
  const [[{ total_devices }]] = await mysqlPool.query(
    `SELECT COUNT(*) AS total_devices FROM devices d
     JOIN cpds c ON c.id = d.cpd_id WHERE d.active = 1 ${scope}`,
    params,
  );
  const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 min
  const [[{ offline_devices }]] = await mysqlPool.query(
    `SELECT COUNT(*) AS offline_devices FROM devices d
     JOIN cpds c ON c.id = d.cpd_id
     WHERE d.active = 1 AND (d.last_seen_at IS NULL OR d.last_seen_at < ?) ${scope}`,
    [cutoff, ...params],
  );
  const [[{ recent_alerts }]] = await mysqlPool.query(
    `SELECT COUNT(*) AS recent_alerts FROM alert_events ae
     JOIN cpds c ON c.id = ae.cpd_id
     WHERE ae.triggered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ${scope}`,
    params,
  );

  res.json({ total_clients, total_devices, offline_devices, online_devices: total_devices - offline_devices, recent_alerts });
});

// Telemetria atual de todos os dispositivos (última leitura por device)
router.get('/telemetry', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope;
  const [devices] = await mysqlPool.query(
    `SELECT d.id, d.mqtt_client_id, d.last_seen_at, d.last_rssi,
            d.connected_since, d.cpd_id, d.name AS device_name,
            c.client_id, c.name AS cpd_name, c.heartbeat_timeout_sec,
            cl.name AS client_name,
            COALESCE(d.temp_max, c.temp_max, cl.default_temp_max)             AS temp_max,
            COALESCE(d.temp_min, c.temp_min, cl.default_temp_min)             AS temp_min,
            COALESCE(d.humidity_max, c.humidity_max, cl.default_humidity_max) AS humidity_max,
            COALESCE(d.humidity_min, c.humidity_min, cl.default_humidity_min) AS humidity_min
     FROM devices d
     JOIN cpds c ON c.id = d.cpd_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE d.active = 1 AND c.active = 1 ${clientId ? 'AND c.client_id = ?' : ''}
     ORDER BY cl.name, c.name, d.name`,
    clientId ? [clientId] : [],
  );

  // Uma única query Influx: última leitura de cada device
  const latestByDevice = await influxService.getLatestReadingsByDevice(10)
    .catch(() => ({})); // Influx fora não derruba o dashboard

  const now = Date.now();
  const results = devices.map(d => {
    const latest   = latestByDevice[String(d.id)] || {};
    // online = visto dentro do timeout de heartbeat do CPD (mesma régua do alerta)
    const isOnline = d.last_seen_at &&
      (now - new Date(d.last_seen_at).getTime()) / 1000 <= (d.heartbeat_timeout_sec || 180);
    return {
      ...d,
      status:          isOnline ? 'online' : 'offline',
      temperature:     latest.temperature ?? null,
      humidity:        latest.humidity ?? null,
      last_seen_at:    d.last_seen_at,
      rssi:            d.last_rssi ?? null,
      connected_since: d.connected_since ?? null,
    };
  });

  res.json(results);
});

// Dashboard: status atual de todos os CPDs do cliente
router.get('/dashboard', auth, scopeToClient, async (req, res) => {
  const clientId = req.clientScope || req.query.client_id;
  const [cpds] = await mysqlPool.query(
    `SELECT c.id, c.name, c.location, cl.name AS client_name,
            (SELECT COUNT(*) FROM alert_events ae
             WHERE ae.cpd_id = c.id AND ae.resolved_at IS NULL) AS open_alerts,
            (SELECT d.last_seen_at FROM devices d
             WHERE d.cpd_id = c.id AND d.active = 1
             ORDER BY d.last_seen_at DESC LIMIT 1) AS last_seen
     FROM cpds c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.active = 1 ${clientId ? 'AND c.client_id = ?' : ''}
     ORDER BY cl.name, c.name`,
    clientId ? [clientId] : [],
  );
  res.json(cpds);
});
// ============================================================
// SSE — Server-Sent Events
// ============================================================

router.get('/sse', async (req, res) => {
  // Autentica via query param (EventSource não suporta headers)
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'token obrigatório' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'token inválido' });
  }

  const clientScope = payload.role === 'superadmin' ? null : (payload.client_id || null);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // desativa buffer do nginx/caddy
  res.flushHeaders();

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(keepalive); }
  }, 20000);

  res.on('close', () => clearInterval(keepalive));

  sseService.addClient(res, clientScope);
});

// ============================================================
// FIRMWARE OTA (autenticação por token de device, não JWT)
// O ESP32 consulta o manifest periodicamente e baixa o binário
// quando a versão difere da que está rodando.
// ============================================================

const fwCrypto = require('crypto');
const fwFs     = require('fs');
const fwPath   = require('path');
const FIRMWARE_DIR = fwPath.join(__dirname, '../../../firmware');

/** Autentica device por headers x-device-id (mqtt_client_id) + x-device-token. */
async function deviceAuth(req, res, next) {
  try {
    const id    = req.headers['x-device-id'];
    const token = req.headers['x-device-token'];
    if (!id || !token) return res.status(401).json({ error: 'credenciais de device obrigatórias' });

    const [rows] = await mysqlPool.query(
      `SELECT d.id, d.token, d.active, c.active AS cpd_active, cl.active AS client_active
       FROM devices d JOIN cpds c ON c.id = d.cpd_id JOIN clients cl ON cl.id = c.client_id
       WHERE d.mqtt_client_id = ?`,
      [id],
    );
    const dev = rows[0];
    if (!dev || !dev.active || !dev.cpd_active || !dev.client_active)
      return res.status(401).json({ error: 'device inválido' });

    // O banco guarda SHA-256 do token; o device envia o token puro
    const hash     = fwCrypto.createHash('sha256').update(String(token)).digest('hex');
    const expected = Buffer.from(dev.token, 'utf8');
    const provided = Buffer.from(hash, 'utf8');
    if (expected.length !== provided.length || !fwCrypto.timingSafeEqual(expected, provided))
      return res.status(401).json({ error: 'token inválido' });

    req.deviceId = dev.id;
    next();
  } catch (err) { next(err); }
}

// GET /api/firmware/manifest → { version, file, md5, size }
router.get('/firmware/manifest', deviceAuth, async (req, res) => {
  const manifestPath = fwPath.join(FIRMWARE_DIR, 'manifest.json');
  if (!fwFs.existsSync(manifestPath))
    return res.status(404).json({ error: 'nenhum firmware publicado' });

  const manifest = JSON.parse(fwFs.readFileSync(manifestPath, 'utf8'));
  const binPath  = fwPath.join(FIRMWARE_DIR, fwPath.basename(manifest.file || ''));
  if (!manifest.version || !manifest.file || !fwFs.existsSync(binPath))
    return res.status(404).json({ error: 'manifest inconsistente' });

  res.json({
    version: manifest.version,
    md5:     manifest.md5 || null,
    size:    fwFs.statSync(binPath).size,
    url:     '/api/firmware/bin',
  });
});

// GET /api/firmware/bin → binário do firmware publicado no manifest
router.get('/firmware/bin', deviceAuth, async (req, res) => {
  const manifestPath = fwPath.join(FIRMWARE_DIR, 'manifest.json');
  if (!fwFs.existsSync(manifestPath)) return res.status(404).end();

  const manifest = JSON.parse(fwFs.readFileSync(manifestPath, 'utf8'));
  // basename impede path traversal via manifest adulterado
  const binPath = fwPath.join(FIRMWARE_DIR, fwPath.basename(manifest.file || ''));
  if (!fwFs.existsSync(binPath)) return res.status(404).end();

  res.setHeader('Content-Type', 'application/octet-stream');
  if (manifest.md5) res.setHeader('x-md5', manifest.md5);
  fwFs.createReadStream(binPath).pipe(res);
});

// ============================================================
// FIRMWARE UPLOAD (superadmin — gerenciamento pelo painel)
// ============================================================

const multer = require('multer');
const fwUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fwFs.existsSync(FIRMWARE_DIR)) fwFs.mkdirSync(FIRMWARE_DIR, { recursive: true });
    cb(null, FIRMWARE_DIR);
  },
  filename: (_req, _file, cb) => cb(null, 'firmware.bin'),
});
const fwUpload = multer({
  storage: fwUploadStorage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB máx
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.bin')) cb(null, true);
    else cb(new Error('Apenas arquivos .bin são aceitos'));
  },
});

// GET /api/firmware/status — versão publicada atual
router.get('/firmware/status', auth, requireRole('superadmin'), async (req, res) => {
  const manifestPath = fwPath.join(FIRMWARE_DIR, 'manifest.json');
  if (!fwFs.existsSync(manifestPath))
    return res.json({ published: false });

  const manifest = JSON.parse(fwFs.readFileSync(manifestPath, 'utf8'));
  const binPath  = fwPath.join(FIRMWARE_DIR, fwPath.basename(manifest.file || ''));
  const size     = fwFs.existsSync(binPath) ? fwFs.statSync(binPath).size : null;

  res.json({ published: true, ...manifest, size });
});

// POST /api/firmware/upload — publica novo firmware
router.post(
  '/firmware/upload',
  auth,
  requireRole('superadmin'),
  (req, res, next) => fwUpload.single('bin')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'arquivo .bin obrigatório' });
    const { version, notes } = req.body;
    if (!version || !/^[\w.\-+]+$/.test(version))
      return res.status(400).json({ error: 'version obrigatório (letras, números, . - +)' });

    const binPath = req.file.path;
    const md5 = fwCrypto
      .createHash('md5')
      .update(fwFs.readFileSync(binPath))
      .digest('hex');

    const manifest = {
      version,
      file:        'firmware.bin',
      md5,
      notes:       notes || null,
      uploaded_at: new Date().toISOString(),
    };
    fwFs.writeFileSync(
      fwPath.join(FIRMWARE_DIR, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    res.json({ ok: true, ...manifest, size: req.file.size });
  },
);

// POST /api/firmware/trigger — envia cmd "update" para devices via MQTT
router.post('/firmware/trigger', auth, requireRole('superadmin'), async (req, res) => {
  const { device_ids } = req.body; // array de IDs do banco; vazio = todos ativos

  let devices;
  if (Array.isArray(device_ids) && device_ids.length > 0) {
    const ids = device_ids.filter(id => Number.isInteger(Number(id)));
    if (!ids.length) return res.status(400).json({ error: 'device_ids inválidos' });
    const [rows] = await mysqlPool.query(
      'SELECT mqtt_client_id FROM devices WHERE id IN (?) AND active = 1',
      [ids],
    );
    devices = rows;
  } else {
    const [rows] = await mysqlPool.query(
      'SELECT mqtt_client_id FROM devices WHERE active = 1',
    );
    devices = rows;
  }

  const { publishCommand } = require('../../mqtt/client');
  let sent = 0;
  for (const d of devices) {
    if (publishCommand(d.mqtt_client_id, 'update')) sent++;
  }

  res.json({ ok: true, sent, total: devices.length });
});

// ============================================================
// DEBUG (apenas superadmin)
// ============================================================

/**
 * POST /api/debug/heartbeat
 * Executa o heartbeat checker imediatamente (sem esperar o cron).
 */
router.post('/debug/heartbeat', auth, requireRole('superadmin'), async (req, res) => {
  const started = Date.now();
  try {
    await checkHeartbeats();
    res.json({
      ok:          true,
      durationMs:  Date.now() - started,
      message:     'checkHeartbeats executado — veja os logs do container para detalhes',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

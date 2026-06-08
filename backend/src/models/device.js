// src/models/device.js
const { mysqlPool } = require('../../config/database');

/**
 * Busca device pelo mqtt_client_id e valida o token.
 * Retorna o device com dados do CPD e cliente, ou null se inválido.
 */
async function findByMqttClientId(mqttClientId) {
  const [rows] = await mysqlPool.query(
    `SELECT
       d.id            AS device_id,
       d.name          AS device_name,
       d.token,
       d.active        AS device_active,
       c.id            AS cpd_id,
       c.name          AS cpd_name,
       c.client_id,
       c.timezone,
       c.heartbeat_interval_sec,
       c.heartbeat_timeout_sec,
       c.active        AS cpd_active,
       cl.name         AS client_name,
       cl.active       AS client_active
     FROM devices d
     JOIN cpds    c  ON c.id  = d.cpd_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE d.mqtt_client_id = ?`,
    [mqttClientId],
  );
  return rows[0] || null;
}

/**
 * Atualiza o last_seen_at do device.
 */
async function updateLastSeen(deviceId, rssi = null) {
  await mysqlPool.query(
    `UPDATE devices SET
       last_seen_at    = NOW(),
       last_rssi       = COALESCE(?, last_rssi),
       connected_since = COALESCE(connected_since, NOW())
     WHERE id = ?`,
    [rssi, deviceId],
  );
}

async function resetConnectedSince(deviceId) {
  await mysqlPool.query(
    'UPDATE devices SET connected_since = NOW() WHERE id = ?',
    [deviceId],
  );
}

/**
 * Retorna todos os devices ativos com dados do CPD para o heartbeat checker.
 */
async function findAllActiveWithCpd() {
  const [rows] = await mysqlPool.query(
    `SELECT
       d.id              AS device_id,
       d.name            AS device_name,
       d.mqtt_client_id,
       d.last_seen_at,
       c.id              AS cpd_id,
       c.name            AS cpd_name,
       c.client_id,
       c.heartbeat_timeout_sec
     FROM devices d
     JOIN cpds    c  ON c.id  = d.cpd_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE d.active = 1 AND c.active = 1 AND cl.active = 1`,
  );
  return rows;
}

module.exports = { findByMqttClientId, updateLastSeen, resetConnectedSince, findAllActiveWithCpd };

// src/models/alert.js
const { mysqlPool } = require('../../config/database');

/**
 * Cria um alert_event e retorna o id gerado.
 */
async function createEvent({ cpdId, deviceId, alertType, severity, value, threshold, message }) {
  const [result] = await mysqlPool.query(
    `INSERT INTO alert_events
       (cpd_id, device_id, alert_type, severity, value, threshold, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cpdId, deviceId || null, alertType, severity, value ?? null, threshold ?? null, message || null],
  );
  return result.insertId;
}

/**
 * Marca um alert_event como resolvido.
 */
async function resolveEvent(eventId) {
  await mysqlPool.query(
    'UPDATE alert_events SET resolved_at = NOW() WHERE id = ? AND resolved_at IS NULL',
    [eventId],
  );
}

/**
 * Busca o alert_event aberto mais recente para um CPD + tipo.
 * Usado para detectar se já há um evento ativo e evitar duplicatas.
 */
async function findOpenEvent(cpdId, alertType) {
  const [rows] = await mysqlPool.query(
    `SELECT id, triggered_at FROM alert_events
     WHERE cpd_id = ? AND alert_type = ? AND resolved_at IS NULL
     ORDER BY triggered_at DESC LIMIT 1`,
    [cpdId, alertType],
  );
  return rows[0] || null;
}

/**
 * Registra o dispatch de uma notificação.
 */
async function createDispatch({ alertEventId, contactId, subscriptionId, channel, destination, status = 'pending' }) {
  const [result] = await mysqlPool.query(
    `INSERT INTO alert_dispatches
       (alert_event_id, contact_id, subscription_id, channel, destination, status, dispatched_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [alertEventId, contactId, subscriptionId, channel, destination, status],
  );
  return result.insertId;
}

/**
 * Atualiza status de um dispatch (sent, failed, suppressed).
 */
async function updateDispatch(dispatchId, { status, n8nWebhookId, errorMessage, deliveredAt }) {
  await mysqlPool.query(
    `UPDATE alert_dispatches
     SET status = ?,
         n8n_webhook_id = COALESCE(?, n8n_webhook_id),
         error_message  = COALESCE(?, error_message),
         delivered_at   = COALESCE(?, delivered_at)
     WHERE id = ?`,
    [status, n8nWebhookId || null, errorMessage || null, deliveredAt || null, dispatchId],
  );
}

/**
 * Verifica se já existe um dispatch de ligação (call) para um evento + contato.
 * Ligações têm dedup por alert_event_id — somente 1 por episódio, independente
 * de cooldown ou quantas leituras passem enquanto o evento fica aberto.
 */
async function hasCallDispatch(alertEventId, contactId) {
  const [rows] = await mysqlPool.query(
    `SELECT id FROM alert_dispatches
     WHERE alert_event_id = ?
       AND contact_id     = ?
       AND channel        = 'call'
       AND status        IN ('pending', 'sent', 'failed')
     LIMIT 1`,
    [alertEventId, contactId],
  );
  return rows.length > 0;
}

/**
 * Retorna o último dispatch ENVIADO para um contato + tipo de alerta
 * dentro do período de cooldown. Usado para suprimir envios repetidos.
 */
async function findRecentDispatch(contactId, alertType, cooldownMinutes) {
  const [rows] = await mysqlPool.query(
    `SELECT d.id, d.dispatched_at
     FROM alert_dispatches d
     JOIN alert_events     e ON e.id = d.alert_event_id
     WHERE d.contact_id = ?
       AND e.alert_type = ?
       AND d.status     IN ('sent', 'failed', 'pending')
       AND d.dispatched_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
     ORDER BY d.dispatched_at DESC
     LIMIT 1`,
    [contactId, alertType, cooldownMinutes],
  );
  return rows[0] || null;
}

/**
 * Busca contatos elegíveis para um alerta:
 * - subscription ativa para o CPD (ou wildcard NULL)
 * - tipo de alerta bate (ou subscription é 'all')
 * - severidade mínima atendida
 * A filtragem de horário e cooldown é feita no motor de regras
 * para ter acesso ao timezone do CPD.
 */
async function findEligibleSubscriptions(cpdId, alertType, severity) {
  const severityOrder = { info: 0, warning: 1, critical: 2 };
  const [rows] = await mysqlPool.query(
    `SELECT
       sub.id              AS subscription_id,
       sub.contact_id,
       sub.alert_type,
       sub.channel,
       sub.time_from,
       sub.time_to,
       sub.weekdays_mask,
       sub.cooldown_minutes,
       sub.severity_min,
       con.name            AS contact_name,
       con.whatsapp,
       con.email,
       con.client_id
     FROM alert_subscriptions sub
     JOIN contacts con ON con.id = sub.contact_id
     WHERE sub.active = 1
       AND con.active = 1
       AND (sub.cpd_id = ? OR sub.cpd_id IS NULL)
       AND (sub.alert_type = ? OR sub.alert_type = 'all')
     ORDER BY sub.contact_id`,
    [cpdId, alertType],
  );

  // Filtra severidade mínima (não dá pra fazer no SQL de forma simples com ENUM)
  return rows.filter(r => severityOrder[severity] >= severityOrder[r.severity_min]);
}

module.exports = {
  createEvent,
  resolveEvent,
  findOpenEvent,
  createDispatch,
  updateDispatch,
  findRecentDispatch,
  hasCallDispatch,
  findEligibleSubscriptions,
};

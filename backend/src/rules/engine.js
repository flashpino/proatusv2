// src/rules/engine.js
const { mysqlPool }         = require('../../config/database');
const alertModel            = require('../models/alert');
const { notifySubscribers } = require('../services/alert.notifier');
const logger                = require('../utils/logger');

/**
 * Avalia uma leitura de sensor e dispara alertas se necessário.
 * Chamado pelo handler MQTT a cada mensagem recebida.
 *
 * @param {object} reading
 * @param {number} reading.deviceId
 * @param {number} reading.cpdId
 * @param {number} reading.clientId
 * @param {number} reading.temperature
 * @param {number} reading.humidity
 */
async function evaluate(reading) {
  const { cpdId, deviceId, temperature, humidity } = reading;

  // Busca thresholds efetivos do CPD (view que faz COALESCE com cliente)
  const [rows] = await mysqlPool.query(
    'SELECT * FROM v_cpd_thresholds WHERE cpd_id = ?',
    [cpdId],
  );
  if (!rows.length) {
    logger.warn('Motor: CPD não encontrado na view de thresholds', { cpdId });
    return;
  }
  const th = rows[0];

  // Busca deltas do device (sobrescreve o padrão do cliente se definido)
  const [devRows] = await mysqlPool.query(
    'SELECT severity_warning_delta, severity_critical_delta FROM devices WHERE id = ?',
    [deviceId],
  );
  const dev = devRows[0] || {};
  const wDelta = parseFloat(dev.severity_warning_delta)  || 2;
  const cDelta = parseFloat(dev.severity_critical_delta) || 5;

  const checks = [
    { type: 'temp_high',     breach: temperature > th.temp_max,     value: temperature, threshold: th.temp_max,     severity: getSeverity(temperature, th.temp_max,     'high', wDelta, cDelta) },
    { type: 'temp_low',      breach: temperature < th.temp_min,     value: temperature, threshold: th.temp_min,     severity: getSeverity(temperature, th.temp_min,     'low',  wDelta, cDelta) },
    { type: 'humidity_high', breach: humidity    > th.humidity_max, value: humidity,    threshold: th.humidity_max, severity: getSeverity(humidity,    th.humidity_max, 'high', wDelta, cDelta) },
    { type: 'humidity_low',  breach: humidity    < th.humidity_min, value: humidity,    threshold: th.humidity_min, severity: getSeverity(humidity,    th.humidity_min, 'low',  wDelta, cDelta) },
  ];

  for (const check of checks) {
    if (check.breach) {
      await triggerAlert({ ...check, cpdId, deviceId, cpd: th });
    } else {
      // Sem breach: resolve qualquer evento aberto desse tipo PARA ESTE device
      await resolveIfOpen(deviceId, check.type);
    }
  }
}

/**
 * Dispara um alerta: cria o event (se não existir) e processa dispatches.
 */
async function triggerAlert({ type, value, threshold, severity, cpdId, deviceId, cpd }) {
  // Evita criar evento duplicado se já existe um aberto para ESTE device
  const existing = await alertModel.findOpenEvent(deviceId, type);
  if (existing) {
    logger.debug('Motor: evento já aberto, ignorando', { deviceId, type });
    return;
  }

  const message = buildMessage(type, value, threshold, cpd);
  const eventId = await alertModel.createEvent({
    cpdId, deviceId, alertType: type, severity, value, threshold, message,
  });

  logger.warn('Motor: alerta gerado', { eventId, cpdId, type, value, threshold, severity });
  await processDispatches(eventId, { type, value, threshold, severity, cpdId, cpd });
}

/**
 * Notifica os contatos elegíveis via serviço unificado (alert.notifier).
 */
async function processDispatches(eventId, { type, value, threshold, severity, cpdId, cpd }) {
  await notifySubscribers({
    eventId, cpdId,
    alertType:  type,
    severity, value, threshold,
    cpdName:    cpd.cpd_name,
    clientName: cpd.client_name,
    message:    buildMessage(type, value, threshold, cpd),
    timezone:   cpd.timezone,
    recordSuppressed: true,
  });
}

/**
 * Se há um evento aberto do tipo para o device, resolve (valor voltou ao normal).
 */
async function resolveIfOpen(deviceId, alertType) {
  const open = await alertModel.findOpenEvent(deviceId, alertType);
  if (!open) return;

  await alertModel.resolveEvent(open.id);
  logger.info('Motor: alerta resolvido', { deviceId, alertType, eventId: open.id });

  // Dispara alerta de retorno (comm_restored é tratado separadamente)
  if (alertType === 'comm_failure') return;
  // Opcional: notificar retorno ao normal
}

/**
 * Calcula severidade baseada no desvio do threshold.
 */
function getSeverity(value, threshold, direction, warningDelta = 2, criticalDelta = 5) {
  const delta = direction === 'high' ? value - threshold : threshold - value;
  if (delta >= criticalDelta) return 'critical';
  if (delta >= warningDelta)  return 'warning';
  return 'info';
}

/**
 * Monta a mensagem legível do alerta.
 */
function buildMessage(type, value, threshold, cpd) {
  const labels = {
    temp_high:     `🌡️ Temperatura ALTA: ${value}°C (limite: ${threshold}°C)`,
    temp_low:      `🌡️ Temperatura BAIXA: ${value}°C (limite: ${threshold}°C)`,
    humidity_high: `💧 Umidade ALTA: ${value}% (limite: ${threshold}%)`,
    humidity_low:  `💧 Umidade BAIXA: ${value}% (limite: ${threshold}%)`,
    comm_failure:  `🔴 FALHA DE COMUNICAÇÃO — dispositivo offline`,
    comm_restored: `✅ Comunicação restaurada`,
  };
  const base = labels[type] || `Alerta: ${type}`;
  return `[${cpd.client_name}] ${cpd.cpd_name}\n${base}`;
}

module.exports = { evaluate, triggerAlert, resolveIfOpen, getSeverity, buildMessage };

// src/rules/engine.js
const { mysqlPool }         = require('../../config/database');
const alertModel            = require('../models/alert');
const webhookService        = require('../services/webhook.service');
const logger                = require('../utils/logger');

// Tipos de alerta que disparam ligação telefônica.
// comm_restored e variantes de "retorno ao normal" ficam fora por decisão de negócio.
// Para habilitar um tipo futuro, basta adicioná-lo aqui.
const CALL_ALERT_TYPES = new Set([
  'temp_high', 'temp_low',
  'humidity_high', 'humidity_low',
  'comm_failure',
]);

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
      // Sem breach: resolve qualquer evento aberto desse tipo
      await resolveIfOpen(cpdId, check.type);
    }
  }
}

/**
 * Dispara um alerta: cria o event (se não existir) e processa dispatches.
 */
async function triggerAlert({ type, value, threshold, severity, cpdId, deviceId, cpd }) {
  // Evita criar evento duplicado se já existe um aberto
  const existing = await alertModel.findOpenEvent(cpdId, type);
  if (existing) {
    logger.debug('Motor: evento já aberto, ignorando', { cpdId, type });
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
 * Para cada subscription elegível, verifica janela de horário + cooldown
 * e envia via webhook se aprovado.
 */
async function processDispatches(eventId, { type, value, threshold, severity, cpdId, cpd }) {
  const subscriptions = await alertModel.findEligibleSubscriptions(cpdId, type, severity);
  if (!subscriptions.length) {
    logger.debug('Motor: nenhum contato elegível', { cpdId, type });
    return;
  }

  const now = new Date();

  for (const sub of subscriptions) {
    // Verifica janela de horário (usa timezone do CPD)
    if (!isInTimeWindow(now, sub.time_from, sub.time_to, sub.weekdays_mask, cpd.timezone)) {
      await alertModel.createDispatch({
        alertEventId: eventId, contactId: sub.contact_id,
        subscriptionId: sub.subscription_id,
        channel: sub.channel === 'both' ? 'whatsapp' : sub.channel,
        destination: sub.whatsapp || sub.email || '',
        status: 'suppressed',
      });
      logger.debug('Motor: fora da janela de horário, suprimido', { contactId: sub.contact_id });
      continue;
    }

    // Verifica cooldown
    const recent = await alertModel.findRecentDispatch(sub.contact_id, type, sub.cooldown_minutes);
    if (recent) {
      logger.debug('Motor: cooldown ativo, suprimido', {
        contactId: sub.contact_id, cooldown: sub.cooldown_minutes,
      });
      continue;
    }

    // Envia via n8n
    const channels = sub.channel === 'both'
      ? ['whatsapp', 'email']
      : [sub.channel];

    for (const channel of channels) {
      // Ligação: dedup por alert_event (1x por episódio) e só para tipos elegíveis
      if (channel === 'call') {
        if (!CALL_ALERT_TYPES.has(type)) {
          logger.debug('Motor: ligação não elegível para este tipo', { type });
          continue;
        }
        const alreadyCalled = await alertModel.hasCallDispatch(eventId, sub.contact_id);
        if (alreadyCalled) {
          logger.debug('Motor: ligação já realizada neste evento', {
            eventId, contactId: sub.contact_id,
          });
          continue;
        }
      }

      const destination = channel === 'whatsapp' ? sub.whatsapp
                        : channel === 'email'    ? sub.email
                        : sub.whatsapp; // call usa o número WhatsApp (mesmo número Twilio)
      if (!destination) continue;

      const dispatchId = await alertModel.createDispatch({
        alertEventId: eventId, contactId: sub.contact_id,
        subscriptionId: sub.subscription_id,
        channel, destination, status: 'pending',
      });

      // fire-and-forget: dispatch 'pending' já bloqueia cooldown sem travar o loop
      webhookService.send({
        dispatchId,
        channel,
        destination,
        alertType:   type,
        severity,
        value,
        threshold,
        cpdName:     cpd.cpd_name,
        clientName:  cpd.client_name,
        contactName: sub.contact_name,
        message:     buildMessage(type, value, threshold, cpd),
      }).catch(() => {});
    }
  }
}

/**
 * Se há um evento aberto do tipo, resolve (valor voltou ao normal).
 */
async function resolveIfOpen(cpdId, alertType) {
  const open = await alertModel.findOpenEvent(cpdId, alertType);
  if (!open) return;

  await alertModel.resolveEvent(open.id);
  logger.info('Motor: alerta resolvido', { cpdId, alertType, eventId: open.id });

  // Dispara alerta de retorno (comm_restored é tratado separadamente)
  if (alertType === 'comm_failure') return;
  // Opcional: notificar retorno ao normal
}

/**
 * Avalia se está dentro da janela de horário e dia da semana.
 */
function isInTimeWindow(now, timeFrom, timeTo, weekdaysMask, timezone) {
  // Converte para horário do CPD
  const local = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const parts = Object.fromEntries(local.map(p => [p.type, p.value]));
  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;

  // Dia da semana: 0=dom...6=sab
  const weekdayMap = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sáb: 6 };
  const dow = weekdayMap[parts.weekday] ?? 0;

  // Verifica bitmask
  if (!((weekdaysMask >> dow) & 1)) return false;

  // Verifica horário
  return timeStr >= timeFrom && timeStr <= timeTo;
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

module.exports = { evaluate, triggerAlert, resolveIfOpen };

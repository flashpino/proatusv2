// src/rules/heartbeat.js
const cron          = require('node-cron');
const deviceModel   = require('../models/device');
const alertModel    = require('../models/alert');
const sseService    = require('../services/sse.service');
const { mysqlPool } = require('../../config/database');
const logger        = require('../utils/logger');
const { notifySubscribers } = require('../services/alert.notifier');

/**
 * Inicia o cron job de verificação de heartbeat.
 * Roda a cada minuto por padrão (configurável via HEARTBEAT_CRON).
 */
function start() {
  const cronExpr = process.env.HEARTBEAT_CRON || '* * * * *';

  cron.schedule(cronExpr, async () => {
    try {
      await checkHeartbeats();
    } catch (err) {
      logger.error('Heartbeat cron: erro inesperado', { error: err.message });
    }
  });

  logger.info(`Heartbeat checker iniciado (${cronExpr})`);
}

async function checkHeartbeats() {
  const devices = await deviceModel.findAllActiveWithCpd();

  logger.info(`Heartbeat: verificando ${devices.length} device(s)`);

  for (const device of devices) {
    const { device_id, device_name, cpd_id, cpd_name, client_id, last_seen_at, heartbeat_timeout_sec, timezone } = device;

    if (!last_seen_at) {
      logger.info('Heartbeat: device sem last_seen_at, ignorando', { deviceId: device_id, deviceName: device_name });
      continue;
    }

    const lastSeenMs = new Date(last_seen_at).getTime();
    const nowMs      = Date.now();
    const secondsSinceLastSeen = (nowMs - lastSeenMs) / 1000;
    const isOffline  = secondsSinceLastSeen > heartbeat_timeout_sec;

    logger.info('Heartbeat: status do device', {
      deviceId:     device_id,
      deviceName:   device_name,
      lastSeenAt:   last_seen_at,
      secondsSince: Math.round(secondsSinceLastSeen),
      timeoutSec:   heartbeat_timeout_sec,
      isOffline,
    });

    if (isOffline) {
      logger.warn('Heartbeat: device OFFLINE — disparando comm_failure', {
        deviceId: device_id, deviceName: device_name,
        cpdId: cpd_id, secondsSince: Math.round(secondsSinceLastSeen),
      });

      sseService.broadcast('telemetry', { id: device_id, status: 'offline' }, client_id);
      await triggerCommFailure({ device, secondsSinceLastSeen });
    } else {
      await resolveCommFailure(cpd_id, device_id, cpd_name, client_id, timezone);
    }
  }
}

async function triggerCommFailure({ device, secondsSinceLastSeen }) {
  const { device_id, device_name, cpd_id, cpd_name, timezone } = device;

  // Busca nome do cliente
  const [clientRows] = await mysqlPool.query(
    'SELECT cl.name AS client_name FROM cpds c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?',
    [cpd_id],
  );
  const clientName = clientRows[0]?.client_name || 'Desconhecido';

  const message = `🔴 FALHA DE COMUNICAÇÃO\n[${clientName}] ${cpd_name} — sensor ${device_name}\nÚltimo sinal há ${Math.round(secondsSinceLastSeen / 60)} min`;

  // Reaproveita o evento aberto (se houver) em vez de abandonar a notificação.
  // Assim o reenvio passa a ser controlado pelo cooldown de cada contato
  // (findRecentDispatch), reavisando a cada `cooldown_minutes` enquanto offline.
  // Evento por device: outro sensor do mesmo CPD não interfere.
  const existing = await alertModel.findOpenEvent(device_id, 'comm_failure');
  let eventId;
  if (existing) {
    eventId = existing.id;
    logger.info('Heartbeat: comm_failure ainda aberto, reavaliando notificações (cooldown)', { cpdId: cpd_id, eventId });
  } else {
    eventId = await alertModel.createEvent({
      cpdId:     cpd_id,
      deviceId:  device_id,
      alertType: 'comm_failure',
      severity:  'critical',
      value:     null,
      threshold: null,
      message,
    });
    logger.warn('Heartbeat: evento comm_failure criado', { eventId, cpdId: cpd_id, deviceId: device_id });
  }

  // Notifica via serviço unificado. Não registra 'suppressed' aqui:
  // o cron roda a cada minuto e poluiria a tabela.
  await notifySubscribers({
    eventId, cpdId: cpd_id,
    alertType: 'comm_failure',
    severity:  'critical',
    cpdName:   cpd_name,
    clientName,
    message,
    timezone,
  });
}

async function resolveCommFailure(cpdId, deviceId, cpdName, clientId, timezone) {
  const open = await alertModel.findOpenEvent(deviceId, 'comm_failure');
  if (!open) return;

  await alertModel.resolveEvent(open.id);
  await deviceModel.resetConnectedSince(deviceId);
  sseService.broadcast('telemetry', { id: deviceId, status: 'online' }, clientId);
  logger.info('Heartbeat: comunicação restaurada', { cpdId, deviceId });

  // Notifica restauração
  const [clientRows] = await mysqlPool.query(
    'SELECT name FROM clients WHERE id = ?', [clientId],
  );
  const clientName = clientRows[0]?.name || 'Desconhecido';
  const message = `✅ Comunicação restaurada\n[${clientName}] ${cpdName}`;

  const eventId = await alertModel.createEvent({
    cpdId, deviceId, alertType: 'comm_restored',
    severity: 'warning', value: null, threshold: null, message,
  });

  // Inscritos de comm_failure recebem o retorno (não existe inscrição própria)
  await notifySubscribers({
    eventId, cpdId,
    alertType:            'comm_restored',
    subscriptionType:     'comm_failure',
    severity:             'warning',
    subscriptionSeverity: 'critical', // quem recebeu a queda recebe o retorno
    cpdName, clientName, message, timezone,
  });
}

module.exports = { start, checkHeartbeats };

// src/services/alert.notifier.js
// Ponto único de notificação de alertas. Todos os caminhos (motor de regras,
// heartbeat, reconexão MQTT, falha de sensor) usam notifySubscribers para
// aplicar as MESMAS regras: janela de horário, cooldown, dedup de ligação,
// resolução de canal e criação do dispatch.

const alertModel         = require('../models/alert');
const webhookService     = require('./webhook.service');
const logger             = require('../utils/logger');
const { isInTimeWindow } = require('../utils/timeWindow');

// Tipos que disparam ligação telefônica.
// Eventos de "retorno ao normal" (comm_restored, sensor_restored) não ligam.
const CALL_ALERT_TYPES = new Set([
  'temp_high', 'temp_low',
  'humidity_high', 'humidity_low',
  'comm_failure', 'sensor_failure',
]);

/**
 * Notifica todos os contatos elegíveis de um alert_event.
 *
 * @param {object} p
 * @param {number} p.eventId
 * @param {number} p.cpdId
 * @param {string} p.alertType         tipo real do evento (vai na mensagem/dispatch)
 * @param {string} [p.subscriptionType] tipo usado para buscar inscrições — eventos
 *   derivados (comm_restored, sensor_failure...) reaproveitam os inscritos de
 *   comm_failure: quem quer saber da queda quer saber do estado do equipamento.
 * @param {string} p.severity
 * @param {string} [p.subscriptionSeverity] severidade usada no filtro de
 *   severity_min das inscrições — um "retorno ao normal" (warning) precisa
 *   alcançar quem assina só critical, já que essa pessoa recebeu a queda.
 * @param {number} [p.value]
 * @param {number} [p.threshold]
 * @param {string} p.cpdName
 * @param {string} p.clientName
 * @param {string} p.message
 * @param {string} p.timezone          fuso do CPD para a janela de horário
 * @param {boolean} [p.recordSuppressed=false] grava dispatch 'suppressed' quando
 *   fora da janela (true só para eventos pontuais; caminhos que reavaliam a cada
 *   minuto, como o heartbeat, poluiriam a tabela)
 * @returns {Promise<number>} quantidade de dispatches criados
 */
async function notifySubscribers(p) {
  const {
    eventId, cpdId, alertType,
    subscriptionType = p.alertType,
    severity, value = null, threshold = null,
    subscriptionSeverity = p.severity,
    cpdName, clientName, message, timezone,
    recordSuppressed = false,
  } = p;

  const subscriptions = await alertModel.findEligibleSubscriptions(cpdId, subscriptionType, subscriptionSeverity);
  if (!subscriptions.length) {
    logger.info('Notifier: nenhuma subscription elegível', { cpdId, alertType, subscriptionType });
    return 0;
  }

  let created = 0;
  const now = new Date();

  for (const sub of subscriptions) {
    // Janela de horário/dia da semana (fuso do CPD)
    if (!isInTimeWindow(now, sub.time_from, sub.time_to, sub.weekdays_mask, timezone)) {
      logger.info('Notifier: fora da janela de horário, suprimido', {
        contactId: sub.contact_id, alertType,
      });
      if (recordSuppressed) {
        await alertModel.createDispatch({
          alertEventId: eventId, contactId: sub.contact_id,
          subscriptionId: sub.subscription_id,
          channel: sub.channel === 'both' ? 'whatsapp' : sub.channel,
          destination: sub.whatsapp || sub.email || '',
          status: 'suppressed',
        });
      }
      continue;
    }

    const channels = sub.channel === 'both' ? ['whatsapp', 'email'] : [sub.channel];

    for (const channel of channels) {
      if (channel === 'call') {
        // Ligação: só para tipos elegíveis, e no máximo 1 por episódio (evento)
        if (!CALL_ALERT_TYPES.has(alertType)) continue;
        if (await alertModel.hasCallDispatch(eventId, sub.contact_id)) {
          logger.info('Notifier: ligação já realizada neste evento', {
            eventId, contactId: sub.contact_id,
          });
          continue;
        }
      } else {
        // Demais canais: cooldown por contato + tipo
        const recent = await alertModel.findRecentDispatch(sub.contact_id, alertType, sub.cooldown_minutes);
        if (recent) {
          logger.info('Notifier: cooldown ativo, suprimido', {
            contactId: sub.contact_id, alertType, cooldown: sub.cooldown_minutes,
          });
          continue;
        }
      }

      const destination = channel === 'email' ? sub.email : sub.whatsapp; // call usa o número WhatsApp
      if (!destination) {
        logger.warn('Notifier: contato sem destino para o canal', {
          contactId: sub.contact_id, contactName: sub.contact_name, channel,
        });
        continue;
      }

      const dispatchId = await alertModel.createDispatch({
        alertEventId:   eventId,
        contactId:      sub.contact_id,
        subscriptionId: sub.subscription_id,
        channel,
        destination,
        status: 'pending',
      });
      created++;

      logger.info('Notifier: dispatch criado', {
        dispatchId, alertType, channel, contactName: sub.contact_name,
      });

      // fire-and-forget: a fila (webhook.queue) espaça os envios;
      // falhas são tratadas pelo worker de retry.
      webhookService.send({
        dispatchId, channel, destination,
        alertType, severity, value, threshold,
        cpdName, clientName,
        contactName: sub.contact_name,
        message,
      }).catch(() => {});
    }
  }

  return created;
}

module.exports = { notifySubscribers, CALL_ALERT_TYPES };

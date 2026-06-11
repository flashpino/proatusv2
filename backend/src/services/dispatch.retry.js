// src/services/dispatch.retry.js
// Worker de reenvio de notificações. Garante que nenhum alerta se perde:
//  - dispatches 'failed' são reenviados com backoff exponencial (2^attempts min)
//    até MAX_ATTEMPTS tentativas;
//  - dispatches 'pending' órfãos (fila em memória perdida num restart/crash
//    do backend) são detectados após 10 min e reenviados.
// O payload é remontado a partir do banco (alert_events + cpds + clients +
// contacts), então o reenvio não depende de nenhum estado em memória.

const cron           = require('node-cron');
const alertModel     = require('../models/alert');
const webhookService = require('./webhook.service');
const logger         = require('../utils/logger');

const MAX_ATTEMPTS = parseInt(process.env.DISPATCH_MAX_RETRIES) || 5;

let running = false;

function start() {
  cron.schedule('* * * * *', async () => {
    if (running) return; // não sobrepõe execuções
    running = true;
    try {
      await retryPending();
    } catch (err) {
      logger.error('Dispatch retry: erro inesperado', { error: err.message });
    } finally {
      running = false;
    }
  });
  logger.info('Dispatch retry worker iniciado (a cada minuto)');
}

async function retryPending() {
  const rows = await alertModel.findRetryableDispatches(MAX_ATTEMPTS);
  if (!rows.length) return;

  logger.warn(`Dispatch retry: reenviando ${rows.length} dispatch(es)`, {
    ids: rows.map(r => r.dispatch_id),
  });

  for (const row of rows) {
    // Marca a tentativa JÁ na hora de enfileirar (status volta a 'pending')
    // para o próximo tick do worker não re-enfileirar o mesmo dispatch.
    await alertModel.markDispatchAttempt(row.dispatch_id);

    webhookService.send({
      dispatchId:  row.dispatch_id,
      channel:     row.channel,
      destination: row.destination,
      alertType:   row.alert_type,
      severity:    row.severity,
      value:       row.value,
      threshold:   row.threshold,
      cpdName:     row.cpd_name,
      clientName:  row.client_name,
      contactName: row.contact_name,
      message:     row.message,
    }).catch(() => {});
  }
}

module.exports = { start, retryPending };

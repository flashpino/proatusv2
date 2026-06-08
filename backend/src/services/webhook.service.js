// src/services/webhook.service.js
const axios          = require('axios');
const alertModel     = require('../models/alert');
const logger         = require('../utils/logger');
const { enqueue }    = require('./webhook.queue');

const N8N_URL    = process.env.N8N_WEBHOOK_URL;
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET;

/**
 * API pública: enfileira o envio. Todos os envios passam pela fila global
 * (webhook.queue) para serem espaçados por WHATSAPP_SEND_GAP_MS e evitar
 * rajada que causa banimento no WhatsApp. Retorna uma Promise que resolve
 * quando o envio efetivamente acontece.
 */
async function send(p) {
  return enqueue(() => doSend(p));
}

/**
 * Envia um payload de alerta para o n8n via webhook (executado pela fila).
 * Atualiza o dispatch com o resultado (sent/failed).
 *
 * @param {object} p
 * @param {number} p.dispatchId
 * @param {string} p.channel       — 'whatsapp' | 'email'
 * @param {string} p.destination   — número ou e-mail
 * @param {string} p.alertType
 * @param {string} p.severity
 * @param {number} p.value
 * @param {number} p.threshold
 * @param {string} p.cpdName
 * @param {string} p.clientName
 * @param {string} p.contactName
 * @param {string} p.message
 */
async function doSend(p) {
  if (!N8N_URL) {
    logger.error('Webhook: N8N_WEBHOOK_URL não configurado');
    return;
  }

  const payload = {
    dispatch_id:  p.dispatchId,
    channel:      p.channel,
    destination:  p.destination,
    alert_type:   p.alertType,
    severity:     p.severity,
    value:        p.value,
    threshold:    p.threshold,
    cpd_name:     p.cpdName,
    client_name:  p.clientName,
    contact_name: p.contactName,
    message:      p.message,
    timestamp:    new Date().toISOString(),
  };

  try {
    const response = await axios.post(N8N_URL, payload, {
      headers: {
        'Content-Type':        'application/json',
        'X-Webhook-Secret':    N8N_SECRET,
        'X-Dispatch-Id':       String(p.dispatchId),
      },
      timeout: 60_000, // 60s — n8n aguarda confirmacao do WhatsApp antes de responder
    });

    const n8nId = response.data?.executionId || response.headers['x-n8n-execution-id'] || null;

    await alertModel.updateDispatch(p.dispatchId, {
      status:       'sent',
      n8nWebhookId: n8nId,
      deliveredAt:  new Date(),
    });

    logger.info('Webhook: enviado com sucesso', {
      dispatchId: p.dispatchId, channel: p.channel, destination: p.destination,
    });

  } catch (err) {
    const errMsg = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;

    await alertModel.updateDispatch(p.dispatchId, {
      status:       'failed',
      errorMessage: errMsg,
    });

    logger.error('Webhook: falha no envio', {
      dispatchId: p.dispatchId,
      error:      errMsg,
    });
  }
}

module.exports = { send };

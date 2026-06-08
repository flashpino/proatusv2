// src/services/webhook.queue.js
// Fila global de envio de notificações.
// Serializa TODOS os webhooks de WhatsApp num único ponto de estrangulamento,
// garantindo um intervalo mínimo entre envios — evita rajada (vários contatos
// ao mesmo tempo) que causa banimento do número no WhatsApp/Evolution.
//
// Como cada contato gera uma chamada separada de webhookService.send(),
// sem essa fila os envios sairiam quase simultâneos. Aqui eles passam um
// de cada vez, espaçados por WHATSAPP_SEND_GAP_MS.

const logger = require('../utils/logger');

// Intervalo mínimo entre dois envios (ms). Default: 4s.
const GAP_MS = parseInt(process.env.WHATSAPP_SEND_GAP_MS) || 4000;

const queue = [];
let processing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Enfileira uma tarefa de envio. Retorna uma Promise que resolve quando
 * a tarefa efetivamente roda (respeitando o gap). A tarefa deve tratar
 * seus próprios erros — a fila nunca rejeita, só segue para a próxima.
 *
 * @param {() => Promise<any>} task
 * @returns {Promise<any>}
 */
function enqueue(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    if (!processing) processQueue();
  });
}

async function processQueue() {
  processing = true;
  while (queue.length) {
    const { task, resolve } = queue.shift();
    try {
      resolve(await task());
    } catch (err) {
      // A task (doSend) já trata e loga seus erros; isto é só um seguro.
      logger.error('Webhook queue: tarefa lançou exceção inesperada', { error: err.message });
      resolve(undefined);
    }

    // Espaça o próximo envio. Mensagem isolada (fila vazia) sai sem atraso.
    if (queue.length) {
      logger.debug('Webhook queue: aguardando gap antes do próximo envio', {
        gapMs: GAP_MS, pendentes: queue.length,
      });
      await sleep(GAP_MS);
    }
  }
  processing = false;
}

module.exports = { enqueue, size: () => queue.length, GAP_MS };

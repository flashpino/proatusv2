// Gerencia conexões Server-Sent Events abertas.
// Qualquer parte do backend chama broadcast(event, data) para empurrar
// um evento para todos os clientes conectados e autenticados.

const clients = new Map(); // clientId → { res, clientScope }
let nextId = 1;

function addClient(res, clientScope) {
  const id = nextId++;
  clients.set(id, { res, clientScope });
  res.on('close', () => clients.delete(id));
  return id;
}

function broadcast(event, data, targetClientId = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, conn] of clients) {
    if (targetClientId !== null && conn.clientScope !== null && conn.clientScope !== targetClientId) {
      continue;
    }
    try {
      conn.res.write(payload);
    } catch {
      // conexão já fechada — o evento 'close' vai limpar
    }
  }
}

module.exports = { addClient, broadcast };

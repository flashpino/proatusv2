// src/mqtt/broker.js
const aedes    = require('aedes');
const net      = require('net');
const crypto   = require('crypto');
const deviceModel  = require('../models/device');
const influxService = require('../services/influx.service');
const engine   = require('../rules/engine');
const logger   = require('../utils/logger');
const sseService = require('../services/sse.service');

// Cache de devices autenticados: mqtt_client_id → device info
// Evita bater no MySQL a cada mensagem
const deviceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const PORT = parseInt(process.env.AEDES_PORT) || 1883;

function createBroker() {
  const broker = aedes();
  const server = net.createServer(broker.handle);

  // ── Autenticação ─────────────────────────────────────────
  broker.authenticate = async (client, username, password, callback) => {
    try {
      const mqttClientId = client.id;
      const token        = password?.toString();

      if (!token) {
        logger.warn('MQTT: autenticação sem token', { clientId: mqttClientId });
        return callback(null, false);
      }

      const device = await deviceModel.findByMqttClientId(mqttClientId);

      if (!device) {
        logger.warn('MQTT: device não encontrado', { clientId: mqttClientId });
        return callback(null, false);
      }

      if (!device.device_active || !device.cpd_active || !device.client_active) {
        logger.warn('MQTT: device/CPD/cliente inativo', { clientId: mqttClientId });
        return callback(null, false);
      }

      // Compara token com timing-safe para evitar timing attack
      const expected = Buffer.from(device.token, 'utf8');
      const provided  = Buffer.from(token, 'utf8');
      if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        logger.warn('MQTT: token inválido', { clientId: mqttClientId });
        return callback(null, false);
      }

      // Armazena no cache
      deviceCache.set(mqttClientId, {
        ...device,
        cachedAt: Date.now(),
      });

      logger.info('MQTT: device autenticado', {
        clientId: mqttClientId,
        device: device.device_name,
        cpd:    device.cpd_name,
      });
      callback(null, true);

    } catch (err) {
      logger.error('MQTT: erro na autenticação', { error: err.message });
      callback(err, false);
    }
  };

  // ── Autorização de publish ───────────────────────────────
  broker.authorizePublish = (client, packet, callback) => {
    const allowed = packet.topic.startsWith(`cpd/${client.id}/`);
    callback(allowed ? null : new Error('Tópico não autorizado'));
  };

  // ── Mensagem recebida ────────────────────────────────────
  broker.on('publish', async (packet, client) => {
    if (!client) return; // mensagem interna do broker

    const topic   = packet.topic;
    const payload = packet.payload?.toString();

    // Tópico esperado: cpd/{mqtt_client_id}/data
    if (!topic.endsWith('/data')) return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      logger.warn('MQTT: payload inválido (não é JSON)', { topic, payload });
      return;
    }

    const device = getDeviceFromCache(client.id);
    if (!device) {
      logger.warn('MQTT: device não encontrado no cache após autenticação', { clientId: client.id });
      return;
    }

    const { temperature, humidity } = data;

    if (typeof temperature !== 'number' || typeof humidity !== 'number') {
      logger.warn('MQTT: campos temperature/humidity ausentes ou inválidos', { data });
      return;
    }

    logger.debug('MQTT: leitura recebida', {
      device: device.device_name,
      cpd:    device.cpd_name,
      temperature, humidity,
    });

    // Atualiza last_seen
    await deviceModel.updateLastSeen(device.device_id).catch(e =>
      logger.error('MQTT: erro ao atualizar last_seen', { error: e.message }),
    );

    // Grava no InfluxDB
    await influxService.writeReading({
      deviceId:    device.device_id,
      cpdId:       device.cpd_id,
      clientId:    device.client_id,
      temperature,
      humidity,
      timestamp:   data.ts ? new Date(data.ts) : new Date(),
    }).catch(e => logger.error('InfluxDB: erro ao gravar', { error: e.message }));

    // Motor de regras
    await engine.evaluate({
      deviceId:    device.device_id,
      cpdId:       device.cpd_id,
      clientId:    device.client_id,
      temperature,
      humidity,
    }).catch(e => logger.error('Motor: erro ao avaliar', { error: e.message }));

    // Push SSE para clientes conectados
    sseService.broadcast('telemetry', {
      id:            device.device_id,
      mqtt_client_id: client.id,
      cpd_id:        device.cpd_id,
      cpd_name:      device.cpd_name,
      client_id:     device.client_id,
      status:        'online',
      temperature,
      humidity,
      last_seen_at:  new Date().toISOString(),
    }, device.client_id);
  });

  // ── Conexão / desconexão ─────────────────────────────────
  broker.on('client', (client) => {
    logger.info('MQTT: cliente conectado', { clientId: client.id });
  });

  broker.on('clientDisconnect', (client) => {
    deviceCache.delete(client.id);
    logger.info('MQTT: cliente desconectado', { clientId: client.id });
  });

  broker.on('clientError', (client, err) => {
    logger.warn('MQTT: erro de cliente', { clientId: client?.id, error: err.message });
  });

  server.listen(PORT, () => {
    logger.info(`MQTT broker escutando na porta ${PORT}`);
  });

  return { broker, server };
}

function getDeviceFromCache(mqttClientId) {
  const cached = deviceCache.get(mqttClientId);
  if (!cached) return null;
  // Invalida cache expirado
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    deviceCache.delete(mqttClientId);
    return null;
  }
  return cached;
}

module.exports = { createBroker };

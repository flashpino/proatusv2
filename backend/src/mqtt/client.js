// src/mqtt/client.js
// Usado quando MQTT_BROKER_HOST está definido (EasyPanel com Mosquitto externo).
// Substitui o broker Aedes embutido — conecta como cliente no Mosquitto
// e assina todos os tópicos de dados e status dos devices.

const mqtt          = require('mqtt');
const deviceModel   = require('../models/device');
const alertModel    = require('../models/alert');
const influxService = require('../services/influx.service');
const engine        = require('../rules/engine');
const { mysqlPool } = require('../../config/database');
const logger        = require('../utils/logger');
const sseService    = require('../services/sse.service');
const { notifySubscribers } = require('../services/alert.notifier');

// Cache de devices: mqtt_client_id → info
const deviceCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000; // 5 min

// Leituras mais antigas que isso não passam pelo motor de regras nem geram
// SSE (são histórico bufferizado no device durante uma queda de conexão).
const FRESH_READING_MAX_AGE_MS = 2 * 60 * 1000;

let client = null;

function connect() {
  const host     = process.env.MQTT_BROKER_HOST;
  const port     = parseInt(process.env.MQTT_BROKER_PORT) || 1883;
  const user     = process.env.MQTT_BROKER_USER     || 'cpd-backend';
  const password = process.env.MQTT_BROKER_PASSWORD || '';

  const url = `mqtt://${host}:${port}`;
  logger.info(`MQTT cliente: conectando em ${url}`);

  client = mqtt.connect(url, {
    // clientId fixo + clean:false = sessão persistente no broker.
    // Mensagens QoS1 publicadas durante uma reconexão breve do backend
    // ficam enfileiradas no Mosquitto em vez de se perderem.
    clientId:           process.env.MQTT_BACKEND_CLIENT_ID || 'cpd-backend',
    username:           user,
    password,
    clean:              false,
    reconnectPeriod:    5000,   // tenta reconectar a cada 5s
    connectTimeout:     15000,
    keepalive:          60,
  });

  client.on('connect', () => {
    logger.info('MQTT cliente: conectado ao broker');
    client.subscribe('cpd/+/data',   { qos: 1 });
    client.subscribe('cpd/+/status', { qos: 1 });
    logger.info('MQTT cliente: inscrito em cpd/+/data e cpd/+/status');
  });

  client.on('message', async (topic, payload, packet) => {
    try {
      await handleMessage(topic, payload.toString(), packet);
    } catch (err) {
      logger.error('MQTT cliente: erro ao processar mensagem', { topic, error: err.message });
    }
  });

  client.on('reconnect', () => {
    logger.warn('MQTT cliente: reconectando...');
  });

  client.on('error', (err) => {
    logger.error('MQTT cliente: erro', { error: err.message });
  });

  client.on('offline', () => {
    logger.warn('MQTT cliente: offline');
  });

  return client;
}

function isConnected() {
  return !!client?.connected;
}

async function handleMessage(topic, payload, packet = {}) {
  // Tópicos: cpd/{mqtt_client_id}/data | cpd/{mqtt_client_id}/status
  const parts = topic.split('/');
  if (parts.length !== 3) return;

  const [, mqttClientId, type] = parts;

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    logger.warn('MQTT cliente: payload inválido', { topic, payload });
    return;
  }

  const device = await getDevice(mqttClientId);
  if (!device) {
    logger.warn('MQTT cliente: device desconhecido', { mqttClientId });
    return;
  }

  if (!device.device_active || !device.cpd_active || !device.client_active) {
    logger.warn('MQTT cliente: device/CPD/cliente inativo', { mqttClientId });
    return;
  }

  if (type === 'data')   return handleData(device, mqttClientId, data);
  if (type === 'status') return handleStatus(device, data, packet);
}

// ── Leituras ─────────────────────────────────────────────────
async function handleData(device, mqttClientId, data) {
  const { temperature, humidity, rssi, ts } = data;
  if (typeof temperature !== 'number' || typeof humidity !== 'number') {
    logger.warn('MQTT cliente: campos inválidos', { data });
    return;
  }

  // age_ms: idade da leitura no momento do publish (0/ausente = leitura ao vivo).
  // O firmware bufferiza leituras durante quedas de conexão e as reenvia com
  // age_ms preenchido para o histórico ficar com o timestamp correto.
  const ageMs    = typeof data.age_ms === 'number' && data.age_ms > 0 ? data.age_ms : 0;
  const readAt   = new Date(Date.now() - ageMs);
  const isFresh  = ageMs < FRESH_READING_MAX_AGE_MS;

  logger.debug('MQTT cliente: leitura recebida', {
    device: device.device_name, cpd: device.cpd_name, temperature, humidity, ageMs,
  });

  // ts é o millis() no momento da CAPTURA; o uptime no momento do publish
  // é ts + age_ms — é isso que detecta reboot e calcula o connected_since.
  const uptimeMs = typeof ts === 'number' ? ts + ageMs : null;
  await deviceModel.updateLastSeen(
    device.device_id,
    typeof rssi === 'number' ? rssi : null,
    uptimeMs,
    typeof data.fw === 'string' ? data.fw : null,
  ).catch(e => logger.error('last_seen: erro', { error: e.message }));

  // Device entregou leitura válida → resolve falhas abertas de comunicação/sensor
  await checkAndResolveCommFailure(device).catch(e =>
    logger.error('comm_restored: erro', { error: e.message }),
  );
  await checkAndResolveSensorFailure(device).catch(e =>
    logger.error('sensor_restored: erro', { error: e.message }),
  );

  // Grava no InfluxDB com o timestamp real da leitura
  await influxService.writeReading({
    deviceId:    device.device_id,
    cpdId:       device.cpd_id,
    clientId:    device.client_id,
    temperature,
    humidity,
    timestamp:   readAt,
  }).catch(e => logger.error('InfluxDB: erro', { error: e.message }));

  // Leituras bufferizadas (antigas) são só histórico: não avaliam regras
  // nem atualizam o dashboard em tempo real.
  if (!isFresh) return;

  await engine.evaluate({
    deviceId:    device.device_id,
    cpdId:       device.cpd_id,
    clientId:    device.client_id,
    temperature,
    humidity,
  }).catch(e => logger.error('Motor: erro', { error: e.message }));

  sseService.broadcast('telemetry', {
    id:             device.device_id,
    mqtt_client_id: mqttClientId,
    cpd_id:         device.cpd_id,
    cpd_name:       device.cpd_name,
    client_id:      device.client_id,
    status:         'online',
    temperature,
    humidity,
    rssi:           typeof rssi === 'number' ? rssi : null,
    last_seen_at:   new Date().toISOString(),
  }, device.client_id);
}

// ── Status (online/offline/sensor_error/...) ─────────────────
async function handleStatus(device, data, packet) {
  // Mensagens retained são estado antigo reentregue na (re)assinatura —
  // não podem disparar alerta de novo.
  if (packet.retain) return;

  const status = data?.status;
  if (typeof status !== 'string') return;

  logger.info('MQTT cliente: status recebido', {
    device: device.device_name, status,
  });

  // Um device reportando sensor_error ESTÁ se comunicando: atualiza last_seen
  // para o problema ser diagnosticado como sensor, não como comunicação.
  if (status === 'sensor_error') {
    await deviceModel.updateLastSeen(device.device_id, null, null).catch(() => {});
    await triggerSensorFailure(device).catch(e =>
      logger.error('sensor_failure: erro', { error: e.message }),
    );
  }
}

/**
 * Abre (uma vez por episódio) o alerta de falha de sensor e notifica.
 * Usa os inscritos de comm_failure — é o mesmo público de "saúde do equipamento".
 */
async function triggerSensorFailure(device) {
  const { device_id, device_name, cpd_id, cpd_name, client_id, timezone } = device;

  const open = await alertModel.findOpenEvent(device_id, 'sensor_failure');
  if (open) return; // episódio já aberto — 1 aviso por episódio

  const clientName = await getClientName(client_id);
  const message = `🟠 FALHA DE SENSOR\n[${clientName}] ${cpd_name} — sensor ${device_name}\nO dispositivo está online, mas o sensor de temperatura/umidade não responde. Provável defeito físico do sensor.`;

  const eventId = await alertModel.createEvent({
    cpdId: cpd_id, deviceId: device_id,
    alertType: 'sensor_failure', severity: 'critical',
    value: null, threshold: null, message,
  });

  logger.warn('MQTT: sensor_failure aberto', { deviceId: device_id, eventId });

  await notifySubscribers({
    eventId, cpdId: cpd_id,
    alertType:        'sensor_failure',
    subscriptionType: 'comm_failure',
    severity:         'critical',
    cpdName:          cpd_name,
    clientName, message, timezone,
  });
}

/**
 * Leitura válida chegou: se havia falha de sensor aberta, resolve e notifica.
 */
async function checkAndResolveSensorFailure(device) {
  const { device_id, device_name, cpd_id, cpd_name, client_id, timezone } = device;

  const open = await alertModel.findOpenEvent(device_id, 'sensor_failure');
  if (!open) return;

  await alertModel.resolveEvent(open.id);
  logger.info('MQTT: sensor_failure resolvido — sensor voltou a ler', { deviceId: device_id, eventId: open.id });

  const clientName = await getClientName(client_id);
  const message = `✅ Sensor recuperado\n[${clientName}] ${cpd_name} — sensor ${device_name}\nO sensor voltou a fornecer leituras válidas`;

  const eventId = await alertModel.createEvent({
    cpdId: cpd_id, deviceId: device_id,
    alertType: 'sensor_restored', severity: 'warning',
    value: null, threshold: null, message,
  });

  await notifySubscribers({
    eventId, cpdId: cpd_id,
    alertType:            'sensor_restored',
    subscriptionType:     'comm_failure',
    severity:             'warning',
    subscriptionSeverity: 'critical',
    cpdName:              cpd_name,
    clientName, message, timezone,
  });
}

/**
 * Se havia um evento comm_failure aberto para ESTE device,
 * resolve imediatamente e notifica os contatos elegíveis.
 * Chamado a cada mensagem MQTT recebida — é idempotente (findOpenEvent protege).
 */
async function checkAndResolveCommFailure(device) {
  const { device_id, device_name, cpd_id, cpd_name, client_id, timezone } = device;

  const open = await alertModel.findOpenEvent(device_id, 'comm_failure');
  if (!open) return; // nenhum evento aberto — nada a resolver

  await alertModel.resolveEvent(open.id);
  await deviceModel.resetConnectedSince(device_id);
  logger.info('MQTT: comm_failure resolvido — device reconectou', { cpdId: cpd_id, deviceId: device_id, eventId: open.id });

  const clientName = await getClientName(client_id);
  const message = `✅ Comunicação restaurada\n[${clientName}] ${cpd_name} — sensor ${device_name}\nDevice reconectou ao servidor`;

  const eventId = await alertModel.createEvent({
    cpdId: cpd_id, deviceId: device_id,
    alertType: 'comm_restored', severity: 'warning',
    value: null, threshold: null, message,
  });

  // Inscritos de comm_failure recebem o retorno (não existe inscrição própria)
  await notifySubscribers({
    eventId, cpdId: cpd_id,
    alertType:            'comm_restored',
    subscriptionType:     'comm_failure',
    severity:             'warning',
    subscriptionSeverity: 'critical', // quem recebeu a queda recebe o retorno
    cpdName:              cpd_name,
    clientName, message, timezone,
  });
}

async function getClientName(clientId) {
  const [rows] = await mysqlPool.query('SELECT name FROM clients WHERE id = ?', [clientId]);
  return rows[0]?.name || 'Desconhecido';
}

async function getDevice(mqttClientId) {
  const cached = deviceCache.get(mqttClientId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached;

  const device = await deviceModel.findByMqttClientId(mqttClientId);
  if (device) deviceCache.set(mqttClientId, { ...device, cachedAt: Date.now() });
  return device || null;
}

// Publica comando para um device específico
function publishCommand(mqttClientId, cmd) {
  if (!client?.connected) {
    logger.warn('MQTT cliente: tentativa de publicar sem conexão');
    return false;
  }
  const topic   = `cpd/${mqttClientId}/cmd`;
  const payload = JSON.stringify({ cmd });
  client.publish(topic, payload, { qos: 1 });
  logger.info('MQTT cliente: comando enviado', { mqttClientId, cmd });
  return true;
}

module.exports = { connect, publishCommand, isConnected };

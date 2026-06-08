// src/index.js — versão EasyPanel
// Detecta automaticamente se deve usar Mosquitto externo ou Aedes embutido
require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const logger              = require('./utils/logger');
const { testMySQL, testInflux } = require('../config/database');
const heartbeat           = require('./rules/heartbeat');
const apiRoutes           = require('./api/routes/index');

// Pasta de logs
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

async function bootstrap() {
  logger.info('Iniciando CPD Monitor...');
  logger.info(`Modo MQTT: ${process.env.MQTT_BROKER_HOST ? 'Mosquitto externo' : 'Aedes embutido'}`);

  await testMySQL();
  await testInflux().catch(err => logger.warn('InfluxDB: falha na conexão inicial — continuando', { error: err.message }));

  // ── Express ───────────────────────────────────────────────
  const app = express();
  app.set('trust proxy', 1); // Confia no proxy reverso (EasyPanel/Caddy/Traefik)
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', methods: ['GET','POST','PUT','DELETE'] }));
  app.use(express.json({ limit: '100kb' }));

  app.use(rateLimit({
    windowMs: 60 * 1000, max: 200,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Muitas requisições' },
  }));
  app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === 'production' ? 10 : 100,
    message: { error: 'Muitas tentativas de login' },
  }));

  app.use('/api', apiRoutes);
  app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

  // Captura erros de async route handlers que não usam try/catch
  // (Express 4 não faz isso automaticamente)
  process.on('unhandledRejection', (reason) => {
    logger.error('UnhandledRejection', { reason: String(reason) });
  });

  app.use((err, req, res, _next) => {
    logger.error('API: erro', { method: req.method, path: req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Erro interno' });
  });

  const PORT = parseInt(process.env.PORT) || 3001;
  app.listen(PORT, () => logger.info(`API REST na porta ${PORT}`));

  // ── MQTT: Mosquitto externo ou Aedes embutido ─────────────
  if (process.env.MQTT_BROKER_HOST) {
    // EasyPanel: conecta no Mosquitto como cliente
    const mqttClient = require('./mqtt/client');
    mqttClient.connect();
  } else {
    // Dev local: sobe o Aedes embutido
    const { createBroker } = require('./mqtt/broker');
    createBroker();
  }

  // ── Heartbeat checker ─────────────────────────────────────
  heartbeat.start();

  logger.info('CPD Monitor iniciado ✓');
}

bootstrap().catch(err => {
  logger.error('Erro fatal', { error: err.message, stack: err.stack });
  process.exit(1);
});

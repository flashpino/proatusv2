// config/database.js
const mysql2     = require('mysql2/promise');
const { InfluxDB } = require('@influxdata/influxdb-client');
const logger     = require('../src/utils/logger');

// ── MySQL ────────────────────────────────────────────────────
const mysqlPool = mysql2.createPool({
  host:               process.env.MYSQL_HOST     || 'localhost',
  port:               parseInt(process.env.MYSQL_PORT) || 3306,
  user:               process.env.MYSQL_USER,
  password:           process.env.MYSQL_PASSWORD,
  database:           process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+00:00',
});

async function testMySQL() {
  const conn = await mysqlPool.getConnection();
  await conn.ping();
  conn.release();
  logger.info('MySQL: conexão OK');
}

// ── InfluxDB 2.x ─────────────────────────────────────────────
// Variáveis de ambiente:
//   INFLUX_URL    = https://seu-host
//   INFLUX_TOKEN  = token de acesso
//   INFLUX_ORG    = nome da organização
//   INFLUX_BUCKET = nome do bucket

const influxClient = new InfluxDB({
  url:   process.env.INFLUX_URL || 'http://localhost:8086',
  token: process.env.INFLUX_TOKEN,
});

// WriteApi singleton com batching + retry interno do client.
// Pontos são bufferizados e enviados em lote (flush a cada 5s ou 100 pontos);
// falhas de rede são retentadas com backoff sem perder pontos do buffer.
let writeApi = null;

function getWriteApi() {
  if (!writeApi) {
    writeApi = influxClient.getWriteApi(
      process.env.INFLUX_ORG,
      process.env.INFLUX_BUCKET,
      'ns',
      {
        batchSize:      100,
        flushInterval:  5000,
        maxRetries:     5,
        maxRetryDelay:  60_000,
        maxBufferLines: 10_000,
        writeFailed(error, lines, attempt) {
          logger.error('InfluxDB: falha no envio em lote', {
            attempt, lines: lines.length, error: error.message,
          });
          // retorna undefined → client segue com o retry padrão
        },
      },
    );
  }
  return writeApi;
}

// Flush final no shutdown — não perde o buffer em deploys
async function closeInflux() {
  if (writeApi) {
    await writeApi.close().catch(err =>
      logger.error('InfluxDB: erro no flush final', { error: err.message }));
    writeApi = null;
  }
}

function getQueryApi() {
  return influxClient.getQueryApi(process.env.INFLUX_ORG);
}

async function testInflux() {
  const queryApi = getQueryApi();
  const query = `buckets() |> filter(fn: (r) => r.name == "${process.env.INFLUX_BUCKET}")`;
  await new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next() {},
      error(err) { reject(err); },
      complete() { resolve(); },
    });
  });
  logger.info('InfluxDB: conexão OK');
}

module.exports = { mysqlPool, getWriteApi, getQueryApi, closeInflux, testMySQL, testInflux };

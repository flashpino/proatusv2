// config/database.js
const mysql2  = require('mysql2/promise');
const { InfluxDB } = require('@influxdata/influxdb-client');
const logger  = require('../src/utils/logger');

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
  timezone:           '+00:00', // MySQL Hostinger opera em UTC — NÃO alterar
});

async function testMySQL() {
  const conn = await mysqlPool.getConnection();
  await conn.ping();
  conn.release();
  logger.info('MySQL: conexão OK');
}

// ── InfluxDB 2.x ─────────────────────────────────────────────
// Variáveis de ambiente necessárias:
//   INFLUX_URL      = http://influxdb:8086
//   INFLUX_TOKEN    = token gerado na UI do InfluxDB
//   INFLUX_ORG      = nome da organização
//   INFLUX_BUCKET   = nome do bucket (ex: cpd_readings)

const influxClient = new InfluxDB({
  url:   process.env.INFLUX_URL || 'http://influxdb:8086',
  token: process.env.INFLUX_TOKEN,
});

// WriteApi e QueryApi são criados sob demanda no service
// para evitar manter conexão desnecessária
function getWriteApi() {
  return influxClient.getWriteApi(
    process.env.INFLUX_ORG,
    process.env.INFLUX_BUCKET,
    'ns', // precisão nanosegundos
  );
}

function getQueryApi() {
  return influxClient.getQueryApi(process.env.INFLUX_ORG);
}

async function testInflux() {
  // Faz uma query simples para testar a conexão
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

module.exports = { mysqlPool, influxClient, getWriteApi, getQueryApi, testMySQL, testInflux };

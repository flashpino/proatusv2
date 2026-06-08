// Cliente HTTP para InfluxDB 2.x com autenticação por sessão (username/password).
// Autenticado via POST /api/v2/signin → cookie de sessão reutilizado.
// Org descoberta automaticamente via GET /api/v2/orgs.

const logger = require('../utils/logger');

const BASE_URL = (() => {
  const host = process.env.INFLUX_HOST || 'http://localhost';
  const port = process.env.INFLUX_PORT;
  // Só adiciona porta se for não-padrão (não 80/443) e ainda não estiver na URL
  if (!port || port === '80' || port === '443' || host.includes(':' + port)) return host;
  return `${host}:${port}`;
})();

const BUCKET   = process.env.INFLUX_DATABASE || process.env.INFLUX_BUCKET;
const USERNAME = process.env.INFLUX_USERNAME;
const PASSWORD = process.env.INFLUX_PASSWORD;

let sessionCookie = null;
let org = null;

async function signin() {
  const credentials = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  const res = await fetch(`${BASE_URL}/api/v2/signin`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`InfluxDB signin falhou (${res.status}): ${body}`);
  }
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/influxdb-oss-session=[^;]+/);
  if (!match) throw new Error('InfluxDB: cookie de sessão não encontrado na resposta de signin');
  sessionCookie = match[0];
  logger.info('InfluxDB: autenticado com sucesso');
}

async function discoverOrg() {
  const res = await authedFetch(`${BASE_URL}/api/v2/orgs`);
  const json = await res.json();
  const first = json.orgs?.[0];
  if (!first) throw new Error('InfluxDB: nenhuma organização encontrada');
  org = first.name;
  logger.info(`InfluxDB: org descoberta — "${org}"`);
}

async function authedFetch(url, options = {}) {
  if (!sessionCookie) await signin();
  const headers = { ...options.headers, Cookie: sessionCookie };
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // Sessão expirou — re-autentica e tenta uma vez mais
    sessionCookie = null;
    await signin();
    headers.Cookie = sessionCookie;
    res = await fetch(url, { ...options, headers });
  }

  return res;
}

async function ensureReady() {
  if (!sessionCookie) await signin();
  if (!org) await discoverOrg();
}

async function write(lineProtocol) {
  await ensureReady();
  const res = await authedFetch(
    `${BASE_URL}/api/v2/write?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(BUCKET)}&precision=ns`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: lineProtocol,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`InfluxDB write falhou (${res.status}): ${body}`);
  }
}

async function query(flux) {
  await ensureReady();
  const res = await authedFetch(
    `${BASE_URL}/api/v2/query?org=${encodeURIComponent(org)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/csv',
      },
      body: JSON.stringify({ query: flux, type: 'flux' }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`InfluxDB query falhou (${res.status}): ${body}`);
  }
  return res.text();
}

async function testConnection() {
  await ensureReady();
  // Consulta simples para verificar que o bucket existe
  const csv = await query(`buckets() |> filter(fn: (r) => r.name == "${BUCKET}") |> limit(n:1)`);
  if (!csv.includes(BUCKET)) {
    logger.warn(`InfluxDB: bucket "${BUCKET}" não encontrado — verifique INFLUX_DATABASE`);
  }
  logger.info('InfluxDB: conexão OK');
}

module.exports = { write, query, testConnection, getBucket: () => BUCKET };

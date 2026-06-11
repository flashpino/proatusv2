// src/services/influx.service.js — InfluxDB 2.x via token
const { Point } = require('@influxdata/influxdb-client');
const { getWriteApi, getQueryApi } = require('../../config/database');
const logger = require('../utils/logger');

async function writeReading({ deviceId, cpdId, clientId, temperature, humidity, timestamp }) {
  const hi = heatIndex(temperature, humidity);
  const writeApi = getWriteApi(); // singleton com batch/retry — não fechar aqui

  const point = new Point('sensor_readings')
    .tag('device_id', String(deviceId))
    .tag('cpd_id',    String(cpdId))
    .tag('client_id', String(clientId))
    .floatField('temperature', temperature)
    .floatField('humidity',    humidity);

  if (hi !== null) point.floatField('heat_index', hi);
  if (timestamp)   point.timestamp(new Date(timestamp));

  writeApi.writePoint(point);

  logger.debug('InfluxDB: leitura enfileirada', { deviceId, cpdId, temperature, humidity });
}

/**
 * Última leitura de CADA device em uma única query (dashboard /telemetry).
 * Retorna { [device_id]: { temperature, humidity, time } }.
 */
async function getLatestReadingsByDevice(maxAgeMinutes = 10) {
  const queryApi = getQueryApi();
  const bucket   = process.env.INFLUX_BUCKET;

  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${parseInt(maxAgeMinutes)}m)
      |> filter(fn: (r) => r._measurement == "sensor_readings")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> group(columns: ["device_id", "_field"])
      |> last()
  `;

  const rows = await collectRows(queryApi, query);
  const byDevice = {};
  for (const r of rows) {
    const id = r.device_id;
    if (!byDevice[id]) byDevice[id] = {};
    byDevice[id][r._field] = r._value;
    byDevice[id].time = r._time;
  }
  return byDevice;
}

async function getLastReadings(cpdId, limit = 60) {
  const queryApi = getQueryApi();
  const bucket   = process.env.INFLUX_BUCKET;

  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${limit}m)
      |> filter(fn: (r) => r._measurement == "sensor_readings")
      |> filter(fn: (r) => r.cpd_id == "${cpdId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${parseInt(limit)})
  `;

  return collectRows(queryApi, query);
}

async function getReadingsByRange(cpdId, from, to) {
  const queryApi = getQueryApi();
  const bucket   = process.env.INFLUX_BUCKET;

  const query = `
    from(bucket: "${bucket}")
      |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
      |> filter(fn: (r) => r._measurement == "sensor_readings")
      |> filter(fn: (r) => r.cpd_id == "${cpdId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: false)
  `;

  return collectRows(queryApi, query);
}

function collectRows(queryApi, query) {
  return new Promise((resolve, reject) => {
    const rows = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) { rows.push(tableMeta.toObject(row)); },
      error(err) { reject(err); },
      complete()  { resolve(rows); },
    });
  });
}

function heatIndex(tempC, humidity) {
  const T = tempC * 9 / 5 + 32;
  const R = humidity;
  if (T < 80) return null;

  const HI =
    -42.379
    + 2.04901523  * T
    + 10.14333127 * R
    - 0.22475541  * T * R
    - 0.00683783  * T * T
    - 0.05481717  * R * R
    + 0.00122874  * T * T * R
    + 0.00085282  * T * R * R
    - 0.00000199  * T * T * R * R;

  return parseFloat(((HI - 32) * 5 / 9).toFixed(2));
}

module.exports = { writeReading, getLastReadings, getReadingsByRange, getLatestReadingsByDevice };

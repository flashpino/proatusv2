// node --test — cálculo de severidade do motor de regras
const { test } = require('node:test');
const assert   = require('node:assert');

// engine.js importa config/database (que cria o pool) — só precisa de env mínimo
process.env.MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const { getSeverity, buildMessage } = require('../src/rules/engine');

test('desvio abaixo do warning delta é info', () => {
  assert.equal(getSeverity(28, 27, 'high', 2, 5), 'info');     // +1
});

test('desvio no warning delta é warning', () => {
  assert.equal(getSeverity(29, 27, 'high', 2, 5), 'warning');  // +2
});

test('desvio no critical delta é critical', () => {
  assert.equal(getSeverity(32, 27, 'high', 2, 5), 'critical'); // +5
});

test('direção low: valor abaixo do mínimo', () => {
  assert.equal(getSeverity(13, 16, 'low', 2, 5), 'warning');   // -3
  assert.equal(getSeverity(10, 16, 'low', 2, 5), 'critical');  // -6
});

test('mensagem inclui cliente, CPD e valores', () => {
  const msg = buildMessage('temp_high', 32.5, 27, { client_name: 'ACME', cpd_name: 'CPD 1' });
  assert.match(msg, /ACME/);
  assert.match(msg, /CPD 1/);
  assert.match(msg, /32\.5/);
  assert.match(msg, /27/);
});

test('tipos novos têm rótulo na mensagem', () => {
  const cpd = { client_name: 'ACME', cpd_name: 'CPD 1' };
  assert.match(buildMessage('comm_failure', null, null, cpd), /FALHA DE COMUNICAÇÃO/);
  assert.match(buildMessage('comm_restored', null, null, cpd), /restaurada/);
});

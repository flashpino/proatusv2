// node --test — janela de horário/dia das alert_subscriptions
const { test } = require('node:test');
const assert   = require('node:assert');
const { isInTimeWindow } = require('../src/utils/timeWindow');

const TZ = 'America/Sao_Paulo';

// Datas fixas (UTC). America/Sao_Paulo = UTC-3 (sem DST desde 2019).
// 2026-06-10 é uma quarta-feira.
const QUARTA_10H  = new Date('2026-06-10T13:00:00Z'); // 10:00 local, qua
const QUARTA_3H   = new Date('2026-06-10T06:00:00Z'); // 03:00 local, qua
const DOMINGO_10H = new Date('2026-06-07T13:00:00Z'); // 10:00 local, dom
const SABADO_23H  = new Date('2026-06-07T02:00:00Z'); // 23:00 local, sáb (06-06)

const TODOS = 127, SEG_SEX = 62, SO_DOMINGO = 1;

test('dia útil dentro da janela comercial passa', () => {
  assert.equal(isInTimeWindow(QUARTA_10H, '08:00:00', '18:00:00', SEG_SEX, TZ), true);
});

test('madrugada fora da janela comercial bloqueia', () => {
  assert.equal(isInTimeWindow(QUARTA_3H, '08:00:00', '18:00:00', TODOS, TZ), false);
});

test('máscara só-domingo bloqueia quarta-feira', () => {
  assert.equal(isInTimeWindow(QUARTA_10H, '00:00:00', '23:59:00', SO_DOMINGO, TZ), false);
});

test('máscara só-domingo permite domingo', () => {
  assert.equal(isInTimeWindow(DOMINGO_10H, '00:00:00', '23:59:00', SO_DOMINGO, TZ), true);
});

test('máscara seg-sex bloqueia domingo', () => {
  assert.equal(isInTimeWindow(DOMINGO_10H, '00:00:00', '23:59:00', SEG_SEX, TZ), false);
});

test('janela cruzando a meia-noite: 23h local dentro de 22:00-06:00', () => {
  assert.equal(isInTimeWindow(SABADO_23H, '22:00:00', '06:00:00', TODOS, TZ), true);
});

test('janela cruzando a meia-noite: 10h local fora de 22:00-06:00', () => {
  assert.equal(isInTimeWindow(QUARTA_10H, '22:00:00', '06:00:00', TODOS, TZ), false);
});

test('timezone inválido não lança e usa fuso do servidor', () => {
  assert.doesNotThrow(() => isInTimeWindow(QUARTA_10H, '00:00:00', '23:59:00', TODOS, 'Fuso/Inexistente'));
  assert.equal(isInTimeWindow(QUARTA_10H, '00:00:00', '23:59:00', TODOS, 'Fuso/Inexistente'), true);
});

test('timezone vazio (CPD sem fuso) não lança', () => {
  assert.doesNotThrow(() => isInTimeWindow(QUARTA_10H, '00:00:00', '23:59:00', TODOS, null));
});

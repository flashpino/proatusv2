// src/utils/timeWindow.js
// Janela de horário/dia da semana das alert_subscriptions, no fuso do CPD.

// 'en-US' evita variações de pontuação/acento nos nomes dos dias
// (pt-BR retorna "qua." com ponto, que quebrava o mapeamento).
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatter(timezone) {
  const opts = {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone || undefined });
  } catch {
    // timezone inválido no banco — usa o fuso do servidor em vez de bloquear alertas
    return new Intl.DateTimeFormat('en-US', opts);
  }
}

/**
 * Avalia se `now` está dentro da janela de horário e dia da semana.
 * weekdaysMask: bitmask Dom=bit0 ... Sáb=bit6 (127 = todos os dias).
 * Suporta janela que cruza a meia-noite (ex.: 22:00–06:00).
 */
function isInTimeWindow(now, timeFrom, timeTo, weekdaysMask, timezone) {
  const parts = Object.fromEntries(
    formatter(timezone).formatToParts(now).map(p => [p.type, p.value]),
  );

  const dow = WEEKDAYS[parts.weekday] ?? 0;
  if (!((weekdaysMask >> dow) & 1)) return false;

  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;
  if (timeFrom <= timeTo) return timeStr >= timeFrom && timeStr <= timeTo;
  return timeStr >= timeFrom || timeStr <= timeTo; // janela cruza a meia-noite
}

module.exports = { isInTimeWindow };

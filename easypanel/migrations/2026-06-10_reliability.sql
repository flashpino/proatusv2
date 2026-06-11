-- Migração: confiabilidade de alertas (2026-06-10)
-- 1. Novos tipos de evento: falha/recuperação de sensor (DHT22/SHT31 morto
--    deixa de ser reportado como "falha de comunicação")
-- 2. alert_dispatches.attempts: contador de tentativas para o worker de retry
--
-- Seguro para rodar em produção: só adiciona valores ao enum (no fim) e
-- uma coluna com default. Idempotente para a coluna via checagem manual.

ALTER TABLE alert_events
  MODIFY alert_type ENUM(
    'temp_high','temp_low','humidity_high','humidity_low',
    'comm_failure','comm_restored',
    'sensor_failure','sensor_restored'
  ) NOT NULL;

ALTER TABLE alert_dispatches
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER status;

-- Migração: adiciona canal 'call' (ligação via Twilio) ao sistema de alertas
-- Executar uma vez em produção antes do deploy do backend.

ALTER TABLE alert_dispatches
  MODIFY COLUMN channel ENUM('whatsapp','email','call') NOT NULL;

ALTER TABLE alert_subscriptions
  MODIFY COLUMN channel ENUM('whatsapp','email','both','call') NOT NULL DEFAULT 'whatsapp';

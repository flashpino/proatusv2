# Deploy — CPD Monitor v2 (produção em escala)

Guia de implantação das mudanças de confiabilidade/segurança. **Siga a ordem** —
várias etapas são interdependentes.

## 0. Pré-requisitos

- Um domínio para o broker (ex.: `mqtt.seudominio.com.br`) e um para a API
  (ex.: `api.seudominio.com.br`), ambos apontando para o servidor.
  TLS de MQTT **exige** hostname — IP puro não recebe certificado Let's Encrypt.
- Acesso ao EasyPanel (backend, Mosquitto, n8n) e ao MySQL.

## 1. Banco de dados (já aplicado em 2026-06-10)

`easypanel/migrations/2026-06-10_reliability.sql`:
- `alert_events.alert_type` ganhou `sensor_failure` / `sensor_restored`
- `alert_dispatches.attempts` (contador do worker de retry)

Se for recriar o banco do zero, rode todas as migrações de `easypanel/migrations/`.

## 2. Rotação de segredos (OBRIGATÓRIO — valores antigos estão no git)

Estavam commitados no repositório e devem ser considerados vazados:

| Segredo | Onde estava | Ação |
|---|---|---|
| Secret do webhook n8n (`wuY1...`) | `n8n fluxo.json` | Gerar novo valor; configurar como **env `CPD_WEBHOOK_SECRET` no container do n8n** e `N8N_WEBHOOK_SECRET` no backend (mesmo valor) |
| Token MQTT do device `esp32-cpd1-1780511557158` | `config.h` | Re-provisionar o device no painel (gera token novo), atualizar `passwd` do Mosquitto e regravar o firmware |
| Senha OTA local | `config.h` | Trocar ao regravar |

Gerar secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

> O fluxo n8n novo **lê o secret de `$env.CPD_WEBHOOK_SECRET`** e falha se não
> estiver configurado. Configure a env ANTES de importar o fluxo atualizado,
> senão todos os alertas serão rejeitados.

## 3. Mosquitto (TLS + ACL)

1. Emita o certificado: `certbot certonly --standalone -d mqtt.seudominio.com.br`
2. Monte no container: `fullchain.pem → /mosquitto/certs/cert.pem`,
   `chain.pem → /mosquitto/certs/chain.pem`, `privkey.pem → /mosquitto/certs/privkey.pem`
3. Suba `easypanel/mosquitto/config/mosquitto.conf` e `easypanel/mosquitto/config/acl`
4. Exponha a porta **8883** (TLS) para a internet; a **1883 deve ficar apenas
   na rede interna do EasyPanel** (backend → broker). NÃO publique 1883.
5. Renovação: cron mensal `certbot renew` + restart do container.

ACL: cada device (username = `mqtt_client_id`) só acessa `cpd/<id-dele>/#`;
o usuário `cpd-backend` acessa `cpd/#`.

Provisionamento de device no broker (até automatizar):
```
mosquitto_passwd /mosquitto/config/passwd <mqtt_client_id>   # senha = token do painel
# reload: kill -HUP 1 (dentro do container)
```

## 4. Backend (EasyPanel)

1. Configure as envs novas (ver `backend/.env.example`):
   - `MQTT_BACKEND_CLIENT_ID=cpd-backend` (produção) — **dev local deve usar
     outro valor** (ex.: `cpd-backend-dev`) ou derruba a sessão da produção
   - `N8N_WEBHOOK_SECRET=<novo secret>`
   - `DISPATCH_MAX_RETRIES=5` (opcional, é o default)
2. Monte volume persistente em `/app/firmware` (binários OTA sobrevivem a deploy)
3. Deploy. O Dockerfile agora tem `HEALTHCHECK` real (o `/health` retorna 503
   se MySQL ou MQTT caírem) — configure restart automático no EasyPanel.
4. **Monitor externo** (quem vigia o vigia): cadastre
   `https://api.seudominio.com.br/health` no UptimeRobot/healthchecks.io
   com alerta para o seu WhatsApp/email.

## 5. n8n

1. Defina as envs no container do n8n:
   - `CPD_WEBHOOK_SECRET=<novo secret>` (igual ao backend)
   - `TWILIO_ACCOUNT_SID=<SID real>` (a URL da chamada usa `$env`)
2. Importe `esp32-firmware-n8n/n8n fluxo.json` por cima do workflow atual
   (ou aplique as mudanças manualmente: secret via env, saídas de erro dos
   nós Evolution/Twilio → "Responde 500", TwiML falando a mensagem do alerta).
3. Teste com um disparo manual (ver §7).

## 6. Firmware v1.1.0

Por device, em `cpd_monitor/config.h`:
- `MQTT_BROKER` = domínio (não IP), `MQTT_PORT` = 8883, `MQTT_USE_TLS` ativo
- `OTA_BASE_URL` = `https://api.seudominio.com.br`
- Token re-provisionado (§2), Wi-Fi da unidade, sensor correto
  (`USE_SHT31` **ou** `USE_DHT22` — confirme o que vai a campo!)
- Em produção, considere comentar `ENABLE_LOCAL_OTA` (reduz superfície)

Primeira gravação é via USB. Depois, publique atualizações em
`backend/firmware/` (ver `backend/firmware/README.md`) — os devices se
atualizam sozinhos em até 6h, ou imediatamente com o comando MQTT
`{"cmd":"update"}` no tópico `cpd/<id>/cmd`.

Comportamento novo do device:
- Broker fora do ar → **não reinicia**; bufferiza até 2h de leituras (RAM) e
  reenvia com timestamp correto (`age_ms`) quando a conexão volta
- Wi-Fi caído por 15 min contínuos → reinicia (destrava o rádio)
- Sensor morto → 1 restart de recuperação; se persistir, fica online
  reportando `sensor_error` (alerta "FALHA DE SENSOR" — não confundir com
  falha de comunicação; economiza visita errada)

## 7. Validação pós-deploy (checklist)

- [ ] `GET /health` → 200 com `{mysql: true, mqtt: true}`
- [ ] Device conecta via TLS 8883 e o dashboard atualiza em tempo real
- [ ] Desligue o device por >3 min → WhatsApp de FALHA DE COMUNICAÇÃO
- [ ] Ligue de volta → WhatsApp de comunicação restaurada + uptime zera
- [ ] Desconecte o DHT22/SHT31 com o device ligado → alerta de FALHA DE SENSOR
      (não de comunicação) em ~2,5 min
- [ ] Derrube o n8n por 5 min durante um alerta → dispatch `failed` é
      reenviado pelo worker (ver `alert_dispatches.attempts`)
- [ ] Janela de horário: inscrição 08:00–18:00 não dispara de madrugada
- [ ] Com 2 devices no mesmo CPD: desligar um NÃO gera flapping no outro
- [ ] Publique um firmware de teste no manifest → device atualiza via
      `{"cmd":"update"}` e reporta `fw` novo no payload

## 8. Limitações conhecidas (aceitas por design)

- Backend é single-instance (fila, SSE e cache em memória) — escalar é
  vertical; o retry de dispatches é persistido no MySQL e sobrevive a restarts.
- Buffer offline do device é RAM: perde-se se faltar energia na unidade
  (o InfluxDB fica com gap, mas os alertas de comunicação cobrem o episódio).
- `millis()` do ESP32 dá rollover a cada ~49,7 dias — o uptime exibido zera.
- Canal e-mail do n8n segue placeholder (pendente de integração SMTP/SES).
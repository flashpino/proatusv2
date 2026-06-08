# CPD Monitor v2

Monorepo com backend Node.js/Express e frontend React 18 + TypeScript + Vite + Tailwind CSS v3.

## Estrutura

```
cpd-monitor-v2/
├── backend/              Node.js + Express + MySQL + InfluxDB + MQTT
│   ├── src/
│   │   ├── api/routes/index.js     todos os endpoints REST
│   │   ├── api/middleware/auth.js  JWT + roles (superadmin, admin, viewer)
│   │   ├── models/device.js
│   │   ├── models/alert.js
│   │   ├── mqtt/broker.js          Aedes (dev local)
│   │   ├── mqtt/client.js          cliente Mosquitto (produção)
│   │   ├── rules/engine.js         regras de alerta
│   │   ├── rules/heartbeat.js      cron de heartbeat
│   │   ├── services/influx.service.js
│   │   ├── services/webhook.service.js
│   │   └── utils/logger.js         Winston
│   ├── config/database.js          pools MySQL + InfluxDB
│   ├── .env                        variáveis reais (não commitado)
│   └── package.json                porta padrão: 3001
│
└── frontend/             React 18 + TS + Vite + Tailwind
    ├── src/
    │   ├── types/index.ts          todos os tipos TypeScript
    │   ├── services/api.ts         cliente REST (usa /api com proxy Vite)
    │   ├── hooks/
    │   │   ├── useAuth.ts          lê/grava token no localStorage
    │   │   └── useSSE.ts           hook para Server-Sent Events
    │   ├── components/layout/
    │   │   ├── AppLayout.tsx       wrapper autenticado (redireciona /login)
    │   │   └── Sidebar.tsx         navegação lateral
    │   └── pages/
    │       ├── Auth/LoginPage.tsx
    │       ├── Dashboard/DashboardPage.tsx   KPIs + cards de sensores (SSE em tempo real)
    │       └── Clients/
    │           ├── ClientsPage.tsx           lista de clientes
    │           ├── ClientDetailPage.tsx      abas: Locais (CPDs) | Contatos
    │           ├── LocalDetailPage.tsx       um CPD: abas Sensores | Configurações
    │           ├── SensorDetailPage.tsx      um device: abas Leituras | Alertas | Configurações
    │           └── ContactDetailPage.tsx     editar contato + inscrições de alerta
    ├── vite.config.ts              proxy /api → http://localhost:3001
    ├── tailwind.config.js
    └── package.json                porta: 5173
```

## Como rodar

```bash
# Terminal 1 — backend
cd backend
npm run dev        # nodemon src/index.js — porta 3001

# Terminal 2 — frontend
cd frontend
npm run dev        # Vite — porta 5173, abre no browser
```

## Rotas implementadas no frontend

| Rota | Componente | Status |
|------|-----------|--------|
| `/login` | LoginPage | pronto |
| `/dashboard` | DashboardPage | pronto (SSE em tempo real) |
| `/clients` | ClientsPage | pronto |
| `/clients/:clientId` | ClientDetailPage | pronto (abas Locais/Contatos) |
| `/clients/:clientId/cpds/:cpdId` | LocalDetailPage | pronto |
| `/clients/:clientId/cpds/:cpdId/devices/:deviceId` | SensorDetailPage | pronto |
| `/clients/:clientId/contacts/:contactId` | ContactDetailPage | pronto |

## Hierarquia de navegação e terminologia

> **Atenção à terminologia:** na URL e no backend chama-se `cpd`, mas na UI é exibido como **"Local"**. Cada Local (CPD) contém vários **Sensores** (devices).

```
Clientes  →  Cliente (ClientDetail: abas Locais | Contatos)
                ├── Local / CPD (LocalDetail)
                │     ├── aba Sensores  → lista devices, provisionar (token one-time)
                │     ├── aba Configurações → severity_warning_delta / severity_critical_delta
                │     └── Sensor / Device (SensorDetail)
                │           ├── aba Leituras → gráfico Recharts (temp + umidade)
                │           ├── aba Alertas  → histórico de alertas do device
                │           └── aba Configurações → nome + temp_max/min + humidity_max/min
                └── Contato (ContactDetail)
                      ├── dados: nome, whatsapp, email
                      └── inscrições de alerta (alert_subscriptions): CRUD completo
```

### Detalhes de implementação importantes

- **Leituras e alertas são por device, não por CPD.** As telas usam `GET /api/devices/:id/readings` e `GET /api/devices/:id/alerts`. Os endpoints por CPD (`/api/cpds/:id/readings|alerts`) existem no `api.ts` mas não são usados pelas telas atuais.
- **Thresholds em dois níveis:** limites absolutos por device (`temp_max/min`, `humidity_max/min`) + deltas de severidade por CPD (`severity_warning_delta`, `severity_critical_delta`; vazio = padrão warning 2, critical 5).
- **Status online/offline** é derivado no frontend: device é "online" se `last_seen_at` está dentro dos últimos 5 minutos.
- **alert_subscriptions:** campos `cpd_id` (null = todos os locais), `alert_type` (`all`/`temp_high`/`temp_low`/`humidity_high`/`humidity_low`/`comm_failure`), `channel` (`whatsapp`/`email`/`call`), `severity_min` (`warning`/`critical`), `time_from`/`time_to`, `weekdays_mask` (bitmask Dom=bit0..Sáb=bit6, 127 = todos), `cooldown_minutes`.
- **Dashboard em tempo real:** `DashboardPage` consome SSE via `useSSE<TelemetryReading>('/api/sse', 'telemetry')` — o polling de 15s foi removido.

## Endpoints da API

```
POST   /api/auth/login
GET    /api/clients                   superadmin
POST   /api/clients
PUT    /api/clients/:id
DELETE /api/clients/:id

GET    /api/cpds
GET    /api/cpds/:id
POST   /api/cpds
PUT    /api/cpds/:id
DELETE /api/cpds/:id

GET    /api/cpds/:cpdId/devices
POST   /api/cpds/:cpdId/devices       retorna token one-time no body
PUT    /api/devices/:id
DELETE /api/devices/:id
GET    /api/devices

GET    /api/contacts?client_id=X
POST   /api/contacts
PUT    /api/contacts/:id
DELETE /api/contacts/:id

POST   /api/contacts/:contactId/subscriptions
PUT    /api/contacts/:contactId/subscriptions/:subId
DELETE /api/contacts/:contactId/subscriptions/:subId

GET    /api/devices/:deviceId/readings?limit=60     usado pela SensorDetailPage
GET    /api/devices/:deviceId/alerts?limit=50       usado pela SensorDetailPage
GET    /api/cpds/:cpdId/readings?limit=60&from=&to= existe no api.ts mas não usado pelas telas
GET    /api/cpds/:cpdId/alerts?limit=50&open_only=1 existe no api.ts mas não usado pelas telas

GET    /api/sse?token=                              Server-Sent Events (canal 'telemetry')
GET    /api/stats
GET    /api/telemetry
GET    /api/dashboard
```

## Roles e permissões

- `superadmin` — acesso total, vê todos os clientes
- `admin` — acesso ao próprio `client_id` (scopeToClient middleware)
- `viewer` — somente leitura

## Decisões de design

- Frontend não serve arquivos estáticos pelo Express — Vite dev server em dev, `dist/` em produção
- Backend na porta 3001 para não conflitar com cpd-monitor-COMPLETO (porta 3000) rodando em paralelo
- CORS configurado para aceitar `http://localhost:5173` em dev (ajustar `CORS_ORIGIN` no .env para produção)
- SSE vai usar query param `?token=` porque EventSource não suporta headers customizados

## Infraestrutura (EasyPanel)

Configurações em `easypanel/`:

- **MySQL**: pool 10 conexões, timezone UTC fixo — não alterar (Hostinger opera em UTC)
- **InfluxDB 2.x**: env vars `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`
- **Mosquitto**: porta 1883 TCP + 9001 WebSockets, `allow_anonymous false`, auth via `/mosquitto/config/passwd`
- **Migração pendente**: `easypanel/migrations/add_call_channel.sql` — adiciona canal `call` (Twilio) em `alert_dispatches` e `alert_subscriptions`. Executar antes de ativar chamadas telefônicas.

## ESP32 Firmware

Firmware em `esp32-firmware-n8n/cpd_monitor/`. Edite apenas `config.h` por dispositivo.

**Tópicos MQTT:**
- Publica: `cpd/{mqtt_client_id}/data` — payload `{temperature, humidity, ts, rssi, fw}` a cada 30s
  - **OBS:** `ts` é `millis()` do ESP32 (tempo desde boot), não timestamp absoluto — backend usa hora de chegada
- Publica: `cpd/{mqtt_client_id}/status` (retain=true) — `online`/`offline`/`pong`/`sensor_error`/`restarting`
- Subscreve: `cpd/{mqtt_client_id}/cmd` — aceita `restart`, `ping`, `read_now`
- LWT: `cpd/{mqtt_client_id}/status` → `{"status":"offline"}` retain=true

**Auth MQTT:** username=`mqtt_client_id`, password=`token` (SHA-256 retornado ao provisionar o device)

## Pipeline de Alertas (n8n)

Workflow em `esp32-firmware-n8n/n8n fluxo.json`.

**Canais suportados:**
| Canal | Implementação | Status |
|-------|--------------|--------|
| `whatsapp` | **Evolution API** (instância "nti", credencial "evojk") | ativo |
| `email` | placeholder (Code node) | pendente |
| `call` | Twilio via HTTP Request (from: +551150285828) | ativo — requer migração SQL |


**Secret do webhook:** configurar `CPD_WEBHOOK_SECRET` como variável de ambiente no n8n (não deixar hardcoded).

**Payload enviado pelo backend para o n8n:**
```json
{
  "dispatch_id", "channel", "destination", "alert_type", "severity",
  "value", "threshold", "cpd_name", "client_name", "contact_name",
  "message", "timestamp"
}
```

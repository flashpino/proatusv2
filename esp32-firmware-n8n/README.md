# CPD Monitor — Firmware ESP32 + Workflow n8n

## Firmware ESP32

### Bibliotecas necessárias (Arduino IDE → Library Manager)

| Biblioteca            | Autor          | Para                    |
|-----------------------|----------------|-------------------------|
| PubSubClient          | Nick O'Leary   | MQTT                    |
| ArduinoJson           | Benoit Blanchon| JSON (instale v6)       |
| Adafruit SHT31        | Adafruit       | Sensor SHT31 (I2C)      |
| DHT sensor library    | Adafruit       | Sensor DHT22 (opcional) |

### Como provisionar um novo dispositivo

1. No painel web, acesse o CPD desejado
2. Clique em **Adicionar Device** — o sistema gera o `mqtt_client_id` e o `token`
3. Anote os dois valores (o token só aparece uma vez)
4. Edite `config.h` com os valores anotados + SSID + senha Wi-Fi
5. Compile pelo Arduino IDE (`CTRL+R`) e grave via USB (`CTRL+U`)
6. O LED ficará **verde** quando conectado com sucesso

### Placa recomendada no Arduino IDE
- Board: **ESP32 Dev Module**
- Upload Speed: 921600
- Flash Frequency: 80MHz
- Partition Scheme: **Default 4MB with spiffs**

### Formato da mensagem MQTT publicada
Tópico: `cpd/{mqtt_client_id}/data`

```json
{
  "temperature": 24.50,
  "humidity": 55.20,
  "ts": 1718000000000,
  "rssi": -65,
  "fw": "1.0.0"
}
```

### Comandos remotos aceitos
Tópico: `cpd/{mqtt_client_id}/cmd`

```json
{ "cmd": "restart"   }  // Reinicia o dispositivo
{ "cmd": "ping"      }  // Responde com status "pong"
{ "cmd": "read_now"  }  // Publica uma leitura imediatamente
```

### OTA Update

```bash
# Gere o .bin: Arduino IDE → Sketch → Export Compiled Binary
python3 ota_update.py \
  --host 192.168.1.50 \
  --firmware cpd_monitor.ino.bin \
  --password senha_ota_segura
```

---

## Workflow n8n

### Importação

1. No n8n, vá em **Workflows → Import from File**
2. Selecione `n8n_workflow_cpd_alerts.json`
3. Configure as variáveis de ambiente no n8n:

| Variável              | Valor                                        |
|-----------------------|----------------------------------------------|
| `CPD_WEBHOOK_SECRET`  | Mesmo valor de `N8N_WEBHOOK_SECRET` no .env  |

4. Ative o workflow
5. Copie a URL do webhook gerado e cole em `N8N_WEBHOOK_URL` no `.env` do backend

### Fluxo do workflow

```
Webhook recebe POST
  ↓
Valida X-Webhook-Secret
  ↓
Roteia por canal (whatsapp / email / call)
  ↓ whatsapp
Formata mensagem (emoji + dados formatados)
  ↓
Envia via Evolution API
  ↓
Verifica resposta → Responde 200 OK
  ↓ call
Envia ligação via Twilio → Responde 200 OK
```

### Exemplo de mensagem WhatsApp gerada

```
🌡️🔴 *TEMPERATURA ALTA* 🚨 CRÍTICO

🏢 *Cliente:* Empresa Demo Ltda
🖥️ *CPD:* CPD Principal
📊 *Valor atual:* 31.5°C (limite: 27°C)

👤 *Para:* João Técnico
🕐 *Horário:* 03/06/2024 14:30

_CPD Monitor — ID#42_
```

### Configuração Evolution API

As credenciais da Evolution API estão configuradas diretamente no n8n (credencial "evojk", instância "nti").

O número de destino deve estar no formato internacional sem `+`:
`5511999990001` (Brasil + DDD + número)

---

## Diagrama de fluxo completo

```
ESP32 (CPD cliente)
  │  MQTT publish
  ▼
Broker MQTT (Aedes / Mosquitto)
  │  mensagem recebida
  ▼
Backend Node.js
  ├── Grava leitura no InfluxDB
  └── Motor de regras
        │  threshold violado
        ▼
      Busca contatos elegíveis
      (horário + cooldown + severidade)
        │
        ▼
      POST webhook → n8n
        │
        ├── WhatsApp via Z-API → contato
        └── (Email via SendGrid — futuro)

Cron (1 min):
  └── Verifica last_seen_at dos devices
        │  timeout
        └── POST webhook → n8n → WhatsApp "FALHA DE COMUNICAÇÃO"
```

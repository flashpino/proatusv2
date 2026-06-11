/**
 * config.h — CPD Monitor ESP32
 *
 * ESTE É O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR POR DISPOSITIVO.
 * Cada ESP32 instalado em um CPD terá seu próprio config.h.
 *
 * Fluxo de provisionamento:
 *  1. Cadastre o device no painel web → anote mqtt_client_id e token
 *  2. Adicione o device no passwd do Mosquitto (mosquitto_passwd)
 *  3. Edite este arquivo com as credenciais
 *  4. Compile e grave via USB; atualizações futuras chegam via OTA remoto
 */

#pragma once

// ── Identificação do dispositivo ─────────────────────────────
// Obtidos ao cadastrar o device via painel (POST /api/cpds/{id}/devices)
#define MQTT_CLIENT_ID   "esp32-cpd1-1780511557158"
#define MQTT_TOKEN       "COLOQUE_O_TOKEN_AQUI"   // token retornado no cadastro (NÃO commitar valor real)

// ── Versão do firmware ───────────────────────────────────────
#define FIRMWARE_VERSION "1.1.0"

// ── Wi-Fi ────────────────────────────────────────────────────
#define WIFI_SSID        "Nome_da_rede_WiFi"
#define WIFI_PASSWORD    "senha_do_wifi"

// ── MQTT Broker ──────────────────────────────────────────────
#define MQTT_BROKER      "mqtt.seudominio.com.br"  // use DOMÍNIO (necessário p/ TLS)
#define MQTT_PORT        8883                      // 8883 = TLS | 1883 = sem TLS (apenas bancada)

// TLS: comente para desabilitar (somente testes em bancada na rede local!)
#define MQTT_USE_TLS

// Validação do certificado do broker (Let's Encrypt — ISRG Root X1).
// Se MQTT_TLS_INSECURE estiver definido, cifra o tráfego mas NÃO valida o
// certificado (vulnerável a MITM ativo — evite em produção).
// #define MQTT_TLS_INSECURE
#ifndef MQTT_TLS_INSECURE
static const char MQTT_CA_CERT[] =
  "-----BEGIN CERTIFICATE-----\n"
  "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\n"
  "-----END CERTIFICATE-----\n";
#endif

// ── OTA remoto (pull via backend) ────────────────────────────
// O device consulta o manifest periodicamente e atualiza sozinho.
// Use HTTPS em produção (mesmo CA acima). Ex.: https://api.seudominio.com.br
#define OTA_BASE_URL           "https://api.seudominio.com.br"
#define OTA_MANIFEST_PATH      "/api/firmware/manifest"
#define OTA_CHECK_INTERVAL_MS  (6UL * 60UL * 60UL * 1000UL)  // a cada 6h

// OTA local (ArduinoOTA, apenas bancada/rede local).
// Comente para desabilitar em produção (reduz superfície de ataque).
#define ENABLE_LOCAL_OTA
#define OTA_PASSWORD     "senha_ota_segura"

// ── Sensor ───────────────────────────────────────────────────
// Descomente UMA das opções abaixo:
#define USE_SHT31    // SHT31 via I2C (recomendado — mais preciso e durável)
// #define USE_DHT22  // DHT22 via pino digital

// Pinos SHT31 (I2C) — padrão ESP32
#define SDA_PIN      21
#define SCL_PIN      22

// Pino DHT22 (usado apenas se USE_DHT22 estiver ativo)
#define DHT_PIN      4

// ── Publicação ───────────────────────────────────────────────
#define PUBLISH_INTERVAL_MS   30000   // 30s

// Leituras inválidas consecutivas para declarar falha de sensor
#define MAX_SENSOR_FAILS      5

// Reanuncia sensor_error a cada N ms enquanto o sensor estiver morto
#define SENSOR_ERROR_REANNOUNCE_MS  (5UL * 60UL * 1000UL)

// ── Buffer offline ───────────────────────────────────────────
// Leituras feitas sem conexão ficam em RAM e são reenviadas na volta,
// com timestamp correto (age_ms). 240 × 30s = 2h de histórico.
#define OFFLINE_BUFFER_SIZE   240

// ── Resiliência de conexão ───────────────────────────────────
// Backoff exponencial com jitter — NUNCA reinicia em loop por causa de
// broker fora do ar (preserva o buffer offline).
#define MQTT_BACKOFF_MIN_MS    5000UL      // 1ª retentativa: 5s
#define MQTT_BACKOFF_MAX_MS    300000UL    // teto: 5 min
// Wi-Fi caído continuamente por mais que isso → reinicia (destrava o rádio)
#define WIFI_RESTART_AFTER_MS  (15UL * 60UL * 1000UL)

// ── Watchdog ─────────────────────────────────────────────────
#define WDT_TIMEOUT_SEC  120

// ── LED de status ────────────────────────────────────────────
#define LED_RED    25
#define LED_GREEN  26
#define LED_BLUE   27
// Descomente se o LED for ânodo comum (inverte lógica)
// #define LED_COMMON_ANODE

// ── Resumo de estados do LED ─────────────────────────────────
//  Laranja          = inicializando / conectando
//  Verde            = operação normal
//  Verde piscante   = online, drenando buffer offline
//  Vermelho         = erro de sensor
//  Roxo             = sem conexão (bufferizando leituras)
//  Azul             = atualização OTA em andamento

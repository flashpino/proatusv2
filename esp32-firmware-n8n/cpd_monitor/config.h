/**
 * config.h — CPD Monitor ESP32
 * 
 * ESTE É O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR POR DISPOSITIVO.
 * Cada ESP32 instalado em um CPD terá seu próprio config.h.
 * 
 * Fluxo de provisionamento:
 *  1. Cadastre o device no painel web → anote mqtt_client_id e token
 *  2. Edite este arquivo com as credenciais
 *  3. Compile e grave via USB ou OTA
 */

#pragma once

// ── Identificação do dispositivo ─────────────────────────────
// Obtidos ao cadastrar o device via POST /api/cpds/{id}/devices
#define MQTT_CLIENT_ID   "esp32-cpd1-1780511557158"   // mqtt_client_id do cadastro
#define MQTT_TOKEN       "750a391305cd06010c2cad94b84ef165caf87a7f9898a14b6f417263b39ca88e"   // token retornado no cadastro

// ── Versão do firmware ───────────────────────────────────────
#define FIRMWARE_VERSION "1.0.0"

// ── Wi-Fi ────────────────────────────────────────────────────
#define WIFI_SSID        "Nome_da_rede_WiFi"
#define WIFI_PASSWORD    "senha_do_wifi"

// ── MQTT Broker ──────────────────────────────────────────────
#define MQTT_BROKER      "147.93.13.193"   // IP ou hostname do broker
#define MQTT_PORT        1883                   // 1883 = sem TLS | 8883 = com TLS

// ── Sensor ───────────────────────────────────────────────────
// Descomente UMA das opções abaixo:
#define USE_SHT31    // SHT31 via I2C (recomendado — mais preciso)
// #define USE_DHT22  // DHT22 via pino digital

// Pinos SHT31 (I2C) — padrão ESP32
#define SDA_PIN      21
#define SCL_PIN      22

// Pino DHT22 (usado apenas se USE_DHT22 estiver ativo)
#define DHT_PIN      4

// ── Publicação ───────────────────────────────────────────────
// Intervalo entre envios de leitura (em milissegundos)
// 30000 = 30 segundos | 60000 = 1 minuto
#define PUBLISH_INTERVAL_MS   30000

// Número máximo de leituras inválidas consecutivas antes de reiniciar
#define MAX_SENSOR_FAILS      5

// ── OTA Update ───────────────────────────────────────────────
// Senha para atualização OTA via Arduino IDE ou script
#define OTA_PASSWORD     "senha_ota_segura"

// ── Watchdog ─────────────────────────────────────────────────
// Tempo em segundos sem resposta para reinício automático
#define WDT_TIMEOUT_SEC  120

// ── LED de status ────────────────────────────────────────────
// GPIO dos canais do LED RGB (ou LEDs separados)
#define LED_RED    25
#define LED_GREEN  26
#define LED_BLUE   27

// Descomente se o LED for cátodo comum (inverte lógica)
// #define LED_COMMON_ANODE

// ── Resumo de estados do LED ─────────────────────────────────
//  Laranja  (R+G)    = inicializando / conectando Wi-Fi
//  Piscando Laranja  = aguardando Wi-Fi
//  Verde            = operação normal
//  Vermelho         = erro (sensor ou Wi-Fi)
//  Piscando Azul    = atualização OTA em andamento

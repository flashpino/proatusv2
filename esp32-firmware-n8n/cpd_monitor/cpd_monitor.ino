/**
 * CPD Monitor — Firmware ESP32
 * 
 * Funcionalidades:
 *  - Leitura de temperatura e umidade via SHT31 ou DHT22
 *  - Conexão Wi-Fi com reconexão automática
 *  - MQTT com autenticação por token + TLS opcional
 *  - Publicação periódica de leituras
 *  - Watchdog para reinício automático em travamento
 *  - OTA update via ArduinoOTA
 *  - LED de status (vermelho = erro, amarelo = conectando, verde = ok)
 *  - Configuração via arquivo config.h
 * 
 * Hardware:
 *  - ESP32 (qualquer variante)
 *  - Sensor SHT31 (I2C) ou DHT22 (digital)
 *  - LED RGB ou 3 LEDs separados (opcional)
 * 
 * Bibliotecas necessárias (instalar pelo Library Manager):
 *  - PubSubClient       (Nick O'Leary)
 *  - ArduinoJson        (Benoit Blanchon) v6+
 *  - Adafruit SHT31     (Adafruit) — se usar SHT31
 *  - DHT sensor library (Adafruit) — se usar DHT22
 *  - ArduinoOTA         (já incluída no ESP32 core)
 * 
 * Conexões SHT31:
 *  SDA → GPIO 21
 *  SCL → GPIO 22
 *  VCC → 3.3V
 *  GND → GND
 * 
 * Conexões DHT22:
 *  DATA → GPIO 4
 *  VCC  → 3.3V
 *  GND  → GND
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <esp_task_wdt.h>
#include "config.h"

struct SensorData {
  float temperature;
  float humidity;
  bool  valid;
};


// ── Sensor ───────────────────────────────────────────────────
#ifdef USE_SHT31
  #include <Adafruit_SHT31.h>
  Adafruit_SHT31 sht31;
#else
  #include <DHT.h>
  DHT dht(DHT_PIN, DHT22);
#endif

// ── MQTT ─────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// ── Estado ───────────────────────────────────────────────────
unsigned long lastPublish    = 0;
unsigned long lastWifiCheck  = 0;
unsigned long lastMqttCheck  = 0;
uint8_t       failCount      = 0;      // erros de leitura consecutivos
bool          otaInProgress  = false;

// Tópicos MQTT
char topicData[80];
char topicStatus[80];
char topicCmd[80];

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== CPD Monitor ESP32 iniciando ===");
  Serial.printf("Versão: %s\n", FIRMWARE_VERSION);
  Serial.printf("Device ID: %s\n", MQTT_CLIENT_ID);

  // LEDs
  pinMode(LED_RED,   OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE,  OUTPUT);
  setLed(255, 165, 0); // Laranja = inicializando

  // Monta tópicos
  snprintf(topicData,   sizeof(topicData),   "cpd/%s/data",   MQTT_CLIENT_ID);
  snprintf(topicStatus, sizeof(topicStatus), "cpd/%s/status", MQTT_CLIENT_ID);
  snprintf(topicCmd,    sizeof(topicCmd),    "cpd/%s/cmd",    MQTT_CLIENT_ID);

  // Sensor
  initSensor();

  // Wi-Fi
  connectWifi();

  // OTA
  setupOTA();

  // MQTT
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);
  connectMqtt();

  // Watchdog — reinicia se travar por WDT_TIMEOUT_SEC segundos
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms     = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);

  setLed(0, 255, 0); // Verde = pronto
  Serial.println("Setup completo ✓");
}

// ─────────────────────────────────────────────────────────────
// Loop principal
// ─────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset(); // Reseta watchdog

  if (otaInProgress) {
    ArduinoOTA.handle();
    return;
  }

  ArduinoOTA.handle();

  unsigned long now = millis();

  // Verifica Wi-Fi a cada 10s
  if (now - lastWifiCheck > 10000) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Wi-Fi perdido, reconectando...");
      setLed(255, 0, 0);
      connectWifi();
    }
  }

  // Verifica MQTT a cada 5s
  if (now - lastMqttCheck > 5000) {
    lastMqttCheck = now;
    if (!mqtt.connected()) {
      Serial.println("MQTT desconectado, reconectando...");
      setLed(255, 165, 0);
      connectMqtt();
    }
  }

  mqtt.loop();

  // Publica leitura no intervalo configurado
  if (now - lastPublish > (unsigned long)PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    publishReading();
  }
}

// ─────────────────────────────────────────────────────────────
// Sensor
// ─────────────────────────────────────────────────────────────
void initSensor() {
#ifdef USE_SHT31
  Wire.begin(SDA_PIN, SCL_PIN);
  if (!sht31.begin(0x44)) {
    Serial.println("ERRO: SHT31 não encontrado!");
    blinkError(10);
  } else {
    Serial.println("SHT31 inicializado ✓");
  }
#else
  dht.begin();
  Serial.println("DHT22 inicializado ✓");
#endif
}

SensorData readSensor() {
  SensorData data = {0, 0, false};

#ifdef USE_SHT31
  data.temperature = sht31.readTemperature();
  data.humidity    = sht31.readHumidity();
  data.valid       = !isnan(data.temperature) && !isnan(data.humidity);
#else
  data.humidity    = dht.readHumidity();
  data.temperature = dht.readTemperature();
  data.valid       = !isnan(data.humidity) && !isnan(data.temperature);
#endif

  // Validação de range
  if (data.valid) {
    data.valid = (data.temperature > -40 && data.temperature < 85)
              && (data.humidity    >= 0   && data.humidity    <= 100);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Publicação MQTT
// ─────────────────────────────────────────────────────────────
void publishReading() {
  SensorData data = readSensor();

  if (!data.valid) {
    failCount++;
    Serial.printf("Leitura inválida (%d/%d)\n", failCount, MAX_SENSOR_FAILS);
    setLed(255, 0, 0);

    if (failCount >= MAX_SENSOR_FAILS) {
      Serial.println("Máximo de falhas atingido — reiniciando...");
      publishStatus("sensor_error");
      delay(1000);
      ESP.restart();
    }
    return;
  }

  failCount = 0;
  setLed(0, 255, 0);

  // Monta JSON
  StaticJsonDocument<128> doc;
  doc["temperature"] = serialized(String(data.temperature, 2));
  doc["humidity"]    = serialized(String(data.humidity, 2));
  doc["ts"]          = millis(); // servidor usará hora de chegada; ts é referência relativa
  doc["rssi"]        = WiFi.RSSI();
  doc["fw"]          = FIRMWARE_VERSION;

  char payload[128];
  serializeJson(doc, payload);

  bool ok = mqtt.publish(topicData, payload, false); // false = não retain
  if (ok) {
    Serial.printf("✓ Publicado: temp=%.2f°C umid=%.2f%%\n",
                  data.temperature, data.humidity);
  } else {
    Serial.println("✗ Falha ao publicar");
  }
}

void publishStatus(const char* status) {
  StaticJsonDocument<64> doc;
  doc["status"] = status;
  doc["fw"]     = FIRMWARE_VERSION;
  char payload[64];
  serializeJson(doc, payload);
  mqtt.publish(topicStatus, payload, true); // retain = true para status
}

// ─────────────────────────────────────────────────────────────
// MQTT — callback de mensagens recebidas (comandos)
// ─────────────────────────────────────────────────────────────
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.printf("MQTT cmd recebido [%s]: %s\n", topic, msg.c_str());

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

  const char* cmd = doc["cmd"];
  if (!cmd) return;

  if (strcmp(cmd, "restart") == 0) {
    Serial.println("Reiniciando por comando remoto...");
    publishStatus("restarting");
    delay(500);
    ESP.restart();
  }
  else if (strcmp(cmd, "ping") == 0) {
    publishStatus("pong");
  }
  else if (strcmp(cmd, "read_now") == 0) {
    publishReading();
  }
}

// ─────────────────────────────────────────────────────────────
// Wi-Fi
// ─────────────────────────────────────────────────────────────
void connectWifi() {
  Serial.printf("Conectando ao Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setHostname(MQTT_CLIENT_ID);

  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
    setLed(attempts % 2 ? 255 : 0, 165, 0);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWi-Fi conectado! IP: %s\n", WiFi.localIP().toString().c_str());
    setLed(0, 255, 0);
  } else {
    Serial.println("\nFalha no Wi-Fi — reiniciando em 10s...");
    delay(10000);
    ESP.restart();
  }
}

// ─────────────────────────────────────────────────────────────
// MQTT
// ─────────────────────────────────────────────────────────────
void connectMqtt() {
  uint8_t attempts = 0;

  while (!mqtt.connected() && attempts < 5) {
    Serial.printf("Conectando ao MQTT %s:%d ...\n", MQTT_BROKER, MQTT_PORT);

    // username pode ser qualquer coisa; password = token de autenticação
    bool ok = mqtt.connect(
      MQTT_CLIENT_ID,
      MQTT_CLIENT_ID,  // username = client_id (para log no broker)
      MQTT_TOKEN,      // password = token SHA-256
      topicStatus,     // last will topic
      1,               // last will QoS
      true,            // last will retain
      "{\"status\":\"offline\"}" // last will payload
    );

    if (ok) {
      Serial.println("MQTT conectado ✓");
      mqtt.subscribe(topicCmd);
      publishStatus("online");
      setLed(0, 255, 0);
      return;
    }

    Serial.printf("Falha MQTT (state=%d), tentativa %d/5\n",
                  mqtt.state(), attempts + 1);
    attempts++;
    delay(3000);
  }

  Serial.println("Não foi possível conectar ao MQTT — reiniciando...");
  delay(5000);
  ESP.restart();
}

// ─────────────────────────────────────────────────────────────
// OTA
// ─────────────────────────────────────────────────────────────
void setupOTA() {
  ArduinoOTA.setHostname(MQTT_CLIENT_ID);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    Serial.println("OTA: iniciando atualização...");
    setLed(0, 0, 255); // Azul = OTA
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("OTA: concluído!");
    setLed(0, 255, 0);
    otaInProgress = false;
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("OTA: %u%%\r", (progress * 100) / total);
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA Erro[%u]\n", error);
    otaInProgress = false;
    setLed(255, 0, 0);
  });

  ArduinoOTA.begin();
  Serial.println("OTA pronto ✓");
}

// ─────────────────────────────────────────────────────────────
// LED RGB (PWM)
// ─────────────────────────────────────────────────────────────
void setLed(uint8_t r, uint8_t g, uint8_t b) {
#ifdef LED_COMMON_ANODE
  analogWrite(LED_RED,   255 - r);
  analogWrite(LED_GREEN, 255 - g);
  analogWrite(LED_BLUE,  255 - b);
#else
  analogWrite(LED_RED,   r);
  analogWrite(LED_GREEN, g);
  analogWrite(LED_BLUE,  b);
#endif
}

void blinkError(uint8_t times) {
  for (uint8_t i = 0; i < times; i++) {
    setLed(255, 0, 0);
    delay(200);
    setLed(0, 0, 0);
    delay(200);
  }
}

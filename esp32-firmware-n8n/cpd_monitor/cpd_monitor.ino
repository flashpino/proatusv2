/**
 * CPD Monitor — Firmware ESP32 v1.1
 *
 * Projetado para unidades REMOTAS onde visita técnica custa caro:
 *  - OTA remoto "pull": o device consulta o backend e se atualiza sozinho
 *  - MQTT com TLS (CA Let's Encrypt embarcado) + autenticação por token
 *  - Reconexão com backoff exponencial + jitter — nunca entra em loop de
 *    reboot por causa de servidor/broker fora do ar
 *  - Buffer offline em RAM: leituras feitas sem conexão são reenviadas
 *    com timestamp correto (campo age_ms) quando a conexão volta
 *  - Falha de sensor NÃO vira boot-loop: tenta 1 restart; se persistir,
 *    permanece online reportando sensor_error (o backend alerta "falha de
 *    sensor", diagnóstico correto para a equipe)
 *  - Watchdog de tarefa para travamentos reais
 *
 * Bibliotecas (Library Manager):
 *  - PubSubClient (Nick O'Leary)
 *  - ArduinoJson (Benoit Blanchon) v6+
 *  - Adafruit SHT31 — se usar SHT31
 *  - DHT sensor library (Adafruit) — se usar DHT22
 *
 * Conexões SHT31: SDA→21, SCL→22, VCC→3.3V, GND→GND
 * Conexões DHT22: DATA→4, VCC→3.3V, GND→GND
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <esp_task_wdt.h>
#include "config.h"

#ifdef ENABLE_LOCAL_OTA
  #include <ArduinoOTA.h>
#endif

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

// ── Rede / MQTT ──────────────────────────────────────────────
#ifdef MQTT_USE_TLS
  WiFiClientSecure netClient;
#else
  WiFiClient netClient;
#endif
PubSubClient mqtt(netClient);

// ── Buffer offline ───────────────────────────────────────────
struct BufferedReading {
  uint32_t ts;       // millis() no momento da captura
  float    temperature;
  float    humidity;
};
BufferedReading offlineBuf[OFFLINE_BUFFER_SIZE];
uint16_t bufHead = 0, bufCount = 0;

// ── Estado ───────────────────────────────────────────────────
unsigned long lastPublish        = 0;
unsigned long lastWifiOk         = 0;
unsigned long nextMqttAttempt    = 0;
unsigned long mqttBackoffMs      = MQTT_BACKOFF_MIN_MS;
unsigned long lastOtaCheck       = 0;
unsigned long lastSensorErrorPub = 0;
unsigned long lastDrainAt        = 0;
uint8_t       failCount          = 0;     // erros de leitura consecutivos
bool          sensorDead         = false;
bool          otaInProgress      = false;
bool          otaCheckRequested  = false;

// Sobrevive a ESP.restart(): garante apenas 1 reboot por episódio de sensor
RTC_DATA_ATTR uint32_t rtcSensorRestarts = 0;

// Tópicos MQTT
char topicData[80];
char topicStatus[80];
char topicCmd[80];

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== CPD Monitor ESP32 iniciando ===");
  Serial.printf("Versão: %s\n", FIRMWARE_VERSION);
  Serial.printf("Device ID: %s\n", MQTT_CLIENT_ID);

  pinMode(LED_RED,   OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE,  OUTPUT);
  setLed(255, 165, 0); // Laranja = inicializando

  snprintf(topicData,   sizeof(topicData),   "cpd/%s/data",   MQTT_CLIENT_ID);
  snprintf(topicStatus, sizeof(topicStatus), "cpd/%s/status", MQTT_CLIENT_ID);
  snprintf(topicCmd,    sizeof(topicCmd),    "cpd/%s/cmd",    MQTT_CLIENT_ID);

  initSensor();

  // Wi-Fi: hostname ANTES do begin; reconexão automática do core ligada
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(MQTT_CLIENT_ID);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiOk = millis();

#ifdef MQTT_USE_TLS
  #ifdef MQTT_TLS_INSECURE
    netClient.setInsecure();           // cifra sem validar — só para testes!
  #else
    netClient.setCACert(MQTT_CA_CERT); // valida o certificado do broker
  #endif
#endif

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);
  mqtt.setBufferSize(512);

#ifdef ENABLE_LOCAL_OTA
  setupLocalOTA();
#endif

  // Watchdog — reinicia se o loop travar por WDT_TIMEOUT_SEC
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms     = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);

  Serial.println("Setup completo ✓");
}

// ─────────────────────────────────────────────────────────────
// Loop principal — totalmente não-bloqueante
// ─────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset();

#ifdef ENABLE_LOCAL_OTA
  ArduinoOTA.handle();
  if (otaInProgress) return;
#endif

  unsigned long now = millis();

  // ── Wi-Fi ──────────────────────────────────────────────────
  if (WiFi.status() == WL_CONNECTED) {
    lastWifiOk = now;
  } else if (now - lastWifiOk > WIFI_RESTART_AFTER_MS) {
    // Rádio possivelmente travado — único caso em que reiniciamos por rede.
    // (Broker fora do ar NÃO reinicia: o Wi-Fi local está ok e o buffer
    //  offline preserva as leituras.)
    Serial.println("Wi-Fi caído há muito tempo — reiniciando para destravar o rádio");
    delay(100);
    ESP.restart();
  }

  // ── MQTT: reconexão com backoff exponencial + jitter ──────
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected() && (long)(now - nextMqttAttempt) >= 0) {
    if (connectMqttOnce()) {
      mqttBackoffMs = MQTT_BACKOFF_MIN_MS;
    } else {
      unsigned long jitter = random(0, mqttBackoffMs / 4 + 1);
      nextMqttAttempt = now + mqttBackoffMs + jitter;
      Serial.printf("MQTT: próxima tentativa em %lus\n", (mqttBackoffMs + jitter) / 1000);
      mqttBackoffMs = min(mqttBackoffMs * 2, (unsigned long)MQTT_BACKOFF_MAX_MS);
    }
  }

  mqtt.loop();

  // ── Leitura periódica ──────────────────────────────────────
  if (now - lastPublish >= (unsigned long)PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    captureAndPublish();
  }

  // ── Drena buffer offline (4 leituras a cada 500ms — sem rajada) ──
  if (mqtt.connected() && bufCount > 0 && now - lastDrainAt >= 500) {
    lastDrainAt = now;
    drainOfflineBuffer(4);
  }

  // ── LED de estado ──────────────────────────────────────────
  if      (sensorDead)        setLed(255, 0, 0);            // vermelho
  else if (!mqtt.connected()) setLed(128, 0, 128);          // roxo = offline
  else if (bufCount > 0)      setLed((now / 250) % 2 ? 0 : 0, (now / 250) % 2 ? 255 : 60, 0); // verde piscante
  else                        setLed(0, 255, 0);            // verde

  // ── OTA remoto ─────────────────────────────────────────────
  bool otaDue = (now - lastOtaCheck >= OTA_CHECK_INTERVAL_MS) || (lastOtaCheck == 0 && now > 60000);
  if (WiFi.status() == WL_CONNECTED && (otaCheckRequested || otaDue)) {
    otaCheckRequested = false;
    lastOtaCheck = now;
    checkRemoteOta();
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

  if (data.valid) {
    data.valid = (data.temperature > -40 && data.temperature < 85)
              && (data.humidity    >= 0  && data.humidity    <= 100);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────
// Captura + publicação (com buffer offline)
// ─────────────────────────────────────────────────────────────
void captureAndPublish() {
  SensorData data = readSensor();

  if (!data.valid) {
    handleSensorFailure();
    return;
  }

  // Sensor ok — limpa estado de falha
  failCount = 0;
  if (sensorDead) {
    Serial.println("Sensor recuperado ✓");
    sensorDead = false;
  }
  rtcSensorRestarts = 0;

  uint32_t ts = millis();

  if (mqtt.connected()) {
    if (!publishReading(data.temperature, data.humidity, ts, 0)) {
      bufferReading(ts, data.temperature, data.humidity);
    }
  } else {
    bufferReading(ts, data.temperature, data.humidity);
  }
}

void handleSensorFailure() {
  if (failCount < MAX_SENSOR_FAILS) failCount++; // satura — não estoura o uint8
  Serial.printf("Leitura inválida (%d/%d)\n", failCount, MAX_SENSOR_FAILS);

  if (failCount < MAX_SENSOR_FAILS) return;

  if (rtcSensorRestarts == 0) {
    // 1ª vez neste episódio: um restart pode recuperar sensor travado
    rtcSensorRestarts = 1;
    Serial.println("Sensor falhou — tentando UM restart de recuperação...");
    publishStatus("sensor_error", false);
    mqtt.loop();
    delay(1000);
    ESP.restart();
  }

  // Restart não resolveu: permanece ONLINE reportando falha de sensor.
  // O backend alerta "falha de sensor" (diagnóstico correto) e o device
  // continua acessível para comandos e OTA.
  sensorDead = true;
  unsigned long now = millis();
  if (mqtt.connected() && (lastSensorErrorPub == 0 || now - lastSensorErrorPub >= SENSOR_ERROR_REANNOUNCE_MS)) {
    lastSensorErrorPub = now;
    publishStatus("sensor_error", false);
    Serial.println("sensor_error reportado ao backend");
  }
}

bool publishReading(float temperature, float humidity, uint32_t ts, uint32_t ageMs) {
  StaticJsonDocument<192> doc;
  doc["temperature"] = serialized(String(temperature, 2));
  doc["humidity"]    = serialized(String(humidity, 2));
  doc["ts"]          = ts;            // millis() na CAPTURA (base do uptime)
  if (ageMs > 0) doc["age_ms"] = ageMs; // idade da leitura (reenvio de buffer)
  doc["rssi"]        = WiFi.RSSI();
  doc["fw"]          = FIRMWARE_VERSION;

  char payload[192];
  serializeJson(doc, payload);

  bool ok = mqtt.publish(topicData, payload, false);
  if (ok) {
    Serial.printf("✓ Publicado: temp=%.2f°C umid=%.2f%% age=%lums\n",
                  temperature, humidity, (unsigned long)ageMs);
  } else {
    Serial.println("✗ Falha ao publicar");
  }
  return ok;
}

// ─────────────────────────────────────────────────────────────
// Buffer offline (anel)
// ─────────────────────────────────────────────────────────────
void bufferReading(uint32_t ts, float temperature, float humidity) {
  uint16_t idx = (bufHead + bufCount) % OFFLINE_BUFFER_SIZE;
  if (bufCount == OFFLINE_BUFFER_SIZE) {
    bufHead = (bufHead + 1) % OFFLINE_BUFFER_SIZE; // descarta a mais antiga
  } else {
    bufCount++;
  }
  offlineBuf[idx] = { ts, temperature, humidity };
  Serial.printf("Leitura bufferizada (%u no buffer)\n", bufCount);
}

void drainOfflineBuffer(uint8_t maxPerCall) {
  uint8_t sent = 0;
  while (bufCount > 0 && sent < maxPerCall && mqtt.connected()) {
    BufferedReading& r = offlineBuf[bufHead];
    uint32_t ageMs = millis() - r.ts; // unsigned: correto mesmo com rollover
    if (!publishReading(r.temperature, r.humidity, r.ts, ageMs)) break;
    bufHead = (bufHead + 1) % OFFLINE_BUFFER_SIZE;
    bufCount--;
    sent++;
    mqtt.loop(); // dá vazão ao TCP entre publicações
  }
  if (sent > 0) Serial.printf("Buffer drenado: %u enviadas, %u restantes\n", sent, bufCount);
}

// ─────────────────────────────────────────────────────────────
// MQTT
// ─────────────────────────────────────────────────────────────
bool connectMqttOnce() {
  Serial.printf("Conectando ao MQTT %s:%d ...\n", MQTT_BROKER, MQTT_PORT);

  bool ok = mqtt.connect(
    MQTT_CLIENT_ID,
    MQTT_CLIENT_ID,            // username = mqtt_client_id (casa com a ACL %u)
    MQTT_TOKEN,                // password = token do provisionamento
    topicStatus,               // LWT topic
    1,                         // LWT QoS
    true,                      // LWT retain
    "{\"status\":\"offline\"}"
  );

  if (ok) {
    Serial.println("MQTT conectado ✓");
    mqtt.subscribe(topicCmd, 1);
    publishStatus("online", true);
    return true;
  }

  Serial.printf("Falha MQTT (state=%d)\n", mqtt.state());
  return false;
}

void publishStatus(const char* status, bool retain) {
  StaticJsonDocument<96> doc;
  doc["status"] = status;
  doc["fw"]     = FIRMWARE_VERSION;
  char payload[96];
  serializeJson(doc, payload);
  mqtt.publish(topicStatus, payload, retain);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg;
  msg.reserve(length);
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.printf("MQTT cmd recebido [%s]: %s\n", topic, msg.c_str());

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

  const char* cmd = doc["cmd"];
  if (!cmd) return;

  if (strcmp(cmd, "restart") == 0) {
    Serial.println("Reiniciando por comando remoto...");
    publishStatus("restarting", false);
    mqtt.loop();
    delay(500);
    ESP.restart();
  }
  else if (strcmp(cmd, "ping") == 0) {
    publishStatus("pong", false);
  }
  else if (strcmp(cmd, "read_now") == 0) {
    captureAndPublish();
  }
  else if (strcmp(cmd, "update") == 0) {
    // Checagem de OTA fora do callback (trabalho pesado no loop principal)
    otaCheckRequested = true;
  }
}

// ─────────────────────────────────────────────────────────────
// OTA remoto (pull) — consulta o manifest no backend e atualiza
// ─────────────────────────────────────────────────────────────
bool beginAuthedRequest(HTTPClient& http, WiFiClientSecure& secure, WiFiClient& plain, const String& url) {
  bool ok;
  if (url.startsWith("https://")) {
#ifdef MQTT_TLS_INSECURE
    secure.setInsecure();
#else
    secure.setCACert(MQTT_CA_CERT);
#endif
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (ok) {
    http.addHeader("x-device-id",    MQTT_CLIENT_ID);
    http.addHeader("x-device-token", MQTT_TOKEN);
    http.setTimeout(15000);
  }
  return ok;
}

void checkRemoteOta() {
  Serial.println("OTA: verificando manifest...");
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;

  String manifestUrl = String(OTA_BASE_URL) + OTA_MANIFEST_PATH;
  if (!beginAuthedRequest(http, secure, plain, manifestUrl)) return;

  int code = http.GET();
  if (code != 200) {
    Serial.printf("OTA: manifest HTTP %d\n", code);
    http.end();
    return;
  }

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, http.getString()) != DeserializationError::Ok) {
    http.end();
    return;
  }
  http.end();

  const char* version = doc["version"];
  const char* url     = doc["url"];
  const char* md5     = doc["md5"] | (const char*)nullptr;
  if (!version || !url) return;

  if (strcmp(version, FIRMWARE_VERSION) == 0) {
    Serial.println("OTA: firmware já está na versão atual");
    return;
  }

  Serial.printf("OTA: nova versão %s disponível (atual %s) — baixando...\n",
                version, FIRMWARE_VERSION);
  performRemoteUpdate(String(OTA_BASE_URL) + url, md5 ? String(md5) : String());
}

void performRemoteUpdate(const String& binUrl, const String& md5) {
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;

  if (!beginAuthedRequest(http, secure, plain, binUrl)) return;

  int code = http.GET();
  if (code != 200) {
    Serial.printf("OTA: download HTTP %d\n", code);
    http.end();
    return;
  }

  int total = http.getSize();
  if (total <= 0 || !Update.begin(total)) {
    Serial.println("OTA: tamanho inválido ou sem espaço na partição");
    http.end();
    return;
  }
  if (md5.length() == 32) Update.setMD5(md5.c_str());

  setLed(0, 0, 255); // azul = OTA
  if (mqtt.connected()) { publishStatus("updating", false); mqtt.loop(); }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[1024];
  int written = 0;
  unsigned long lastDataAt = millis();

  while (written < total && (millis() - lastDataAt) < 30000UL) {
    esp_task_wdt_reset(); // download longo não pode disparar o watchdog
    size_t avail = stream->available();
    if (avail) {
      int r = stream->readBytes(buf, avail > sizeof(buf) ? sizeof(buf) : avail);
      if (r > 0) {
        if (Update.write(buf, r) != (size_t)r) break;
        written += r;
        lastDataAt = millis();
      }
    } else {
      delay(20);
    }
  }
  http.end();

  if (written == total && Update.end(true)) {
    // Gravação na partição inativa concluída e verificada (MD5).
    // Se algo falhar daqui em diante, o boot continua no firmware antigo.
    Serial.println("OTA: concluído ✓ — reiniciando no novo firmware");
    delay(500);
    ESP.restart();
  } else {
    Update.abort();
    Serial.printf("OTA: falhou (%d/%d bytes) — mantendo firmware atual\n", written, total);
    setLed(0, 255, 0);
  }
}

// ─────────────────────────────────────────────────────────────
// OTA local (ArduinoOTA — bancada/rede local)
// ─────────────────────────────────────────────────────────────
#ifdef ENABLE_LOCAL_OTA
void setupLocalOTA() {
  ArduinoOTA.setHostname(MQTT_CLIENT_ID);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    setLed(0, 0, 255);
  });
  ArduinoOTA.onEnd([]() {
    otaInProgress = false;
    setLed(0, 255, 0);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA local erro[%u]\n", error);
    otaInProgress = false;
  });

  ArduinoOTA.begin();
  Serial.println("OTA local pronto ✓");
}
#endif

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

# Firmware OTA — publicação

Coloque aqui o binário compilado e o `manifest.json`. Os devices consultam
`GET /api/firmware/manifest` (a cada 6h, ou imediatamente com o comando MQTT
`{"cmd":"update"}`) e se atualizam sozinhos quando a versão difere.

## Como publicar uma nova versão

1. No Arduino IDE: **Sketch → Export Compiled Binary** (gera o `.bin`)
2. Calcule o MD5 do arquivo:
   - Windows: `certutil -hashfile cpd_monitor-1.1.0.bin MD5`
   - Linux/Mac: `md5sum cpd_monitor-1.1.0.bin`
3. Copie o `.bin` para esta pasta e atualize o `manifest.json`:

```json
{
  "version": "1.1.0",
  "file":    "cpd_monitor-1.1.0.bin",
  "md5":     "<md5-do-arquivo>"
}
```

4. Em produção (EasyPanel), monte esta pasta como volume persistente do
   container do backend (`/app/firmware`) para o binário sobreviver a deploys.

## Segurança

- O download exige autenticação por token de device (headers `x-device-id`
  + `x-device-token`) — o mesmo token do MQTT.
- O ESP32 valida o MD5 antes de ativar a nova partição; download interrompido
  ou corrompido **não** derruba o firmware atual (rollback automático do
  esquema de partição dupla do ESP32).
- A `version` do manifest deve bater com `FIRMWARE_VERSION` do config.h do
  binário publicado — é assim que o device decide atualizar.

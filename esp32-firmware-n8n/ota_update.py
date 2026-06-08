#!/usr/bin/env python3
"""
ota_update.py — Atualiza o firmware de um ESP32 via OTA (rede local ou VPN)

Uso:
    python3 ota_update.py --host 192.168.1.50 --firmware firmware.bin
    python3 ota_update.py --host esp32-cpd1-xxx --firmware firmware.bin --password senha_ota

Pré-requisito: pip install esptool

O arquivo .bin é gerado pelo Arduino IDE em:
  Sketch → Export Compiled Binary  (gera o .bin na pasta do projeto)
"""

import argparse
import socket
import hashlib
import struct
import os
import sys

ESPOTA_PORT = 3232  # Porta padrão do ArduinoOTA


def upload_ota(host, password, firmware_path):
    if not os.path.isfile(firmware_path):
        print(f"Erro: arquivo não encontrado: {firmware_path}")
        sys.exit(1)

    with open(firmware_path, 'rb') as f:
        firmware = f.read()

    firmware_size = len(firmware)
    firmware_md5  = hashlib.md5(firmware).hexdigest()

    print(f"Host:     {host}")
    print(f"Firmware: {firmware_path} ({firmware_size} bytes)")
    print(f"MD5:      {firmware_md5}")

    # Resolve hostname
    try:
        ip = socket.gethostbyname(host)
    except socket.gaierror:
        print(f"Erro: não foi possível resolver {host}")
        sys.exit(1)

    print(f"IP:       {ip}")

    # Conecta na porta de OTA
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(30)
    try:
        sock.connect((ip, ESPOTA_PORT))
    except ConnectionRefusedError:
        print("Erro: conexão recusada — verifique se o dispositivo está online e acessível")
        sys.exit(1)

    # Protocolo ArduinoOTA
    # Envia: 0 FLASH <size> <md5>\n
    cmd = f"0 FLASH {firmware_size} {firmware_md5}\n"
    sock.sendall(cmd.encode())

    # Aguarda resposta de autenticação
    resp = sock.recv(32).decode().strip()
    if resp == "AUTH":
        if not password:
            print("Erro: o dispositivo requer senha OTA")
            sock.close()
            sys.exit(1)
        # Calcula nonce response
        nonce = sock.recv(32).decode().strip()
        resp_hash = hashlib.md5(f"{password}:{nonce}:{firmware_md5}".encode()).hexdigest()
        sock.sendall(f"{resp_hash}\n".encode())
        resp = sock.recv(32).decode().strip()

    if resp != "OK":
        print(f"Erro na autenticação OTA: {resp}")
        sock.close()
        sys.exit(1)

    # Envia firmware em blocos
    print("Enviando firmware...")
    chunk_size = 1024
    sent = 0
    while sent < firmware_size:
        chunk = firmware[sent:sent + chunk_size]
        sock.sendall(chunk)
        sent += len(chunk)
        pct = (sent / firmware_size) * 100
        bar = '█' * int(pct / 5) + '░' * (20 - int(pct / 5))
        print(f"\r[{bar}] {pct:.1f}%  ({sent}/{firmware_size} bytes)", end='', flush=True)

    print("\nFirmware enviado!")

    # Aguarda confirmação final
    try:
        resp = sock.recv(32).decode().strip()
        if resp == "OK":
            print("✓ OTA concluído com sucesso! O dispositivo está reiniciando.")
        else:
            print(f"Resposta inesperada: {resp}")
    except socket.timeout:
        print("Timeout aguardando confirmação (pode ter reiniciado normalmente)")

    sock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='OTA Update para ESP32')
    parser.add_argument('--host',     required=True,  help='IP ou hostname do ESP32')
    parser.add_argument('--firmware', required=True,  help='Caminho para o .bin compilado')
    parser.add_argument('--password', default='',     help='Senha OTA (definida em config.h)')
    args = parser.parse_args()

    upload_ota(args.host, args.password, args.firmware)

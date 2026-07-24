#!/usr/bin/env python3
"""
Módulo Local de Control de Dispositivo Móvil vía ADB
Diseñado para ser compilado con PyInstaller:
    pyinstaller --onefile agent.py

Este ejecutable corre en la PC local del usuario, autentica contra el Backend NestJS,
hace polling de tareas pendientes, ejecuta comandos ADB en el teléfono conectado
y respeta el límite mensual de 1000 SMS por dispositivo.
"""

import os
import sys
import time
import re
import json
import logging
import subprocess
import argparse
import requests

# Habilitar soporte VT100/ANSI en consolas de Windows (cmd.exe / powershell)
if os.name == 'nt':
    os.system('')

# Configuración por defecto
DEFAULT_BACKEND_URL = os.environ.get("BACKEND_URL", "https://api.apscurico.cl")
POLL_INTERVAL_SECONDS = 3
LOG_LEVEL_ENV = os.environ.get("LOG_LEVEL", "INFO").upper()
DEFAULT_LOG_LEVEL = getattr(logging, LOG_LEVEL_ENV, logging.INFO)

# Configuración de Logging de fondo (para archivo/debug)
logging.basicConfig(
    level=DEFAULT_LOG_LEVEL,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("ADB_Agent")


class Colors:
    CYAN = '\033[96m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    WHITE = '\033[97m'
    MAGENTA = '\033[95m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    RESET = '\033[0m'


ANSI_REGEX = re.compile(r'\033\[[0-9;]*m')


def strip_ansi(text: str) -> str:
    return ANSI_REGEX.sub('', text)


def make_box_line(text: str, width: int = 76, border_color: str = Colors.CYAN) -> str:
    visible_len = len(strip_ansi(text))
    padding = max(0, width - 3 - visible_len)
    return f"{border_color}│{Colors.RESET} {text}{' ' * padding}{border_color}│{Colors.RESET}"


def mask_serial(serial):
    if not serial or len(serial) <= 4:
        return serial
    return "••••••••" + serial[-4:]


def mask_phone(phone):
    if not phone or len(phone) <= 4:
        return "••••"
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) <= 4:
        return digits
    return "+56 9 •••• " + digits[-4:]


def get_adb_path() -> str:
    """
    Obtiene la ruta hacia el ejecutable ADB embebido (PyInstaller), local o del PATH.
    """
    import shutil
    # 1. Empaquetado dentro del EXE con PyInstaller (_MEIPASS)
    if hasattr(sys, '_MEIPASS'):
        meipass_adb = os.path.join(sys._MEIPASS, 'adb.exe')
        if os.path.isfile(meipass_adb):
            return meipass_adb
        meipass_tools = os.path.join(sys._MEIPASS, 'platform-tools', 'adb.exe')
        if os.path.isfile(meipass_tools):
            return meipass_tools

    # 2. Mismo directorio donde está el .exe / .py
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(os.path.abspath(sys.executable))
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))

    local_adb = os.path.join(base_dir, 'adb.exe')
    if os.path.isfile(local_adb):
        return local_adb

    # 3. PATH del sistema
    which_adb = shutil.which("adb")
    if which_adb:
        return which_adb

    return "adb"


class ADBDeviceAgent:
    def __init__(self, backend_url=DEFAULT_BACKEND_URL, cli_serial=None, group_id=None):
        self.adb_bin = get_adb_path()
        self.backend_url = backend_url.rstrip("/")
        self.device_serial = None
        self.model_name = None
        self.cli_serial = cli_serial
        self.group_id = group_id or os.environ.get("GROUP_ID")

        # Estado extendido para Dashboard TUI
        self.celular_info = None
        self.monthly_limit = 1000
        self.monthly_usage = 0
        self.session_sent = 0
        self.session_failed = 0
        self.last_sent_info = "Ninguno en esta sesión"
        self.device_status = "offline"
        self.recent_events = []
        self.current_activity = "Iniciando agente local ADB..."

        logger.debug(f"[INIT] ADBDeviceAgent inicializado con backend_url: {self.backend_url} | cli_serial: {self.cli_serial} | group_id: {self.group_id}")

    def log_event(self, message: str, level: str = "INFO"):
        """
        Registra un evento en la bitácora del Dashboard TUI y actualiza la pantalla.
        """
        ts = time.strftime("%H:%M:%S")
        if level == "SUCCESS":
            prefix = f"{Colors.GREEN}[{ts}] >> {Colors.RESET}"
        elif level == "ERROR":
            prefix = f"{Colors.RED}[{ts}] >> {Colors.RESET}"
        elif level == "WARNING":
            prefix = f"{Colors.YELLOW}[{ts}] >> {Colors.RESET}"
        else:
            prefix = f"{Colors.CYAN}[{ts}] >> {Colors.RESET}"

        formatted_msg = f"{prefix} {message}"
        self.recent_events.append(formatted_msg)
        if len(self.recent_events) > 30:
            self.recent_events.pop(0)

        logger.debug(f"[{level}] {message}")
        self.render_dashboard()

    def render_dashboard(self, activity_msg=None):
        """
        Renderiza el Dashboard TUI en tiempo real en la terminal.
        """
        if activity_msg:
            self.current_activity = activity_msg

        # Limpiar pantalla de consola para repintado limpio
        os.system('cls' if os.name == 'nt' else 'clear')

        width = 76
        C_BORDER = Colors.CYAN
        line_str = "─" * (width - 2)

        print(f"{C_BORDER}┌{line_str}┐{Colors.RESET}")
        print(make_box_line(f"{Colors.BOLD}{Colors.CYAN}ERP APSCURICO - AGENTE LOCAL - ENVIO DE SMS AUTOMATIZADO{Colors.RESET}", width, C_BORDER))
        print(f"{C_BORDER}├{line_str}┤{Colors.RESET}")

        # Sección 1: Información del Dispositivo & Inventario ERP
        sn_full = self.device_serial or "No seleccionado"
        last_4 = sn_full[-4:] if len(sn_full) >= 4 else sn_full
        web_masked = sn_full[:-4] + "••••" if len(sn_full) > 4 else "••••"

        cel = self.celular_info or {}
        marca_mod = f"{cel.get('marca', '')} {cel.get('modelo', '')}".strip()
        if not marca_mod:
            marca_mod = self.model_name or "No Seleccionado"

        sim_num = cel.get('numero') or "Sin SIM asignada"
        custodio = cel.get('nombre_completo') or "Sin Custodio registrado en ERP"
        id_est = cel.get('id_establecimiento')
        est_str = f"Establecimiento #{id_est}" if id_est else "Sin Establecimiento"

        if self.device_status == "online":
            status_badge = f"{Colors.GREEN}{Colors.BOLD}🟢 EN LÍNEA (ONLINE){Colors.RESET}"
        elif self.device_status == "quota_exceeded":
            status_badge = f"{Colors.RED}{Colors.BOLD}⛔ CUOTA EXCEDIDA{Colors.RESET}"
        else:
            status_badge = f"{Colors.RED}{Colors.BOLD}🔴 DESCONECTADO (OFFLINE){Colors.RESET}"

        print(make_box_line(f"{Colors.BOLD}{Colors.WHITE}DISPOSITIVO MÓVIl{Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Modelo Equipo      : {Colors.BOLD}{Colors.WHITE}{marca_mod}{Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Serial SN Completo  : {Colors.BOLD}{sn_full}{Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Serial Censurado Web: {web_masked}", width, C_BORDER))
        print(make_box_line(f"• {Colors.YELLOW}{Colors.BOLD}CÓDIGO VINCULACIÓN WEB : {last_4}{Colors.RESET} {Colors.DIM}(Ingresar últimos 4 dígitos en el ERP){Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Nº SIM / Teléfono   : {sim_num}", width, C_BORDER))
        print(make_box_line(f"• Custodio / Usuario  : {Colors.CYAN}{custodio}{Colors.RESET} {Colors.DIM}({est_str}){Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Estado Conexión     : {status_badge}", width, C_BORDER))

        print(f"{C_BORDER}├{line_str}┤{Colors.RESET}")

        # Sección 2: Métricas de Cuota & Mensajería
        usage = self.monthly_usage
        limit = self.monthly_limit or 1000
        pct = min(100.0, (usage / limit) * 100) if limit > 0 else 0.0

        bar_len = 18
        filled = int(bar_len * pct // 100)
        bar = "█" * filled + "░" * (bar_len - filled)

        bar_color = Colors.GREEN if pct < 80 else (Colors.YELLOW if pct < 100 else Colors.RED)

        print(make_box_line(f"{Colors.BOLD}{Colors.WHITE}MÉTRICAS Y ACTIVIDAD DE ENVÍO SMS{Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• Cuota Mensual  : {bar_color}[{bar}] {usage}/{limit} SMS ({pct:.1f}%){Colors.RESET}", width, C_BORDER))
        print(make_box_line(f"• SMS Enviados   : {Colors.GREEN}{Colors.BOLD}{self.session_sent}{Colors.RESET} SMS exitosos esta sesión", width, C_BORDER))
        print(make_box_line(f"• SMS Fallidos   : {Colors.RED}{Colors.BOLD}{self.session_failed}{Colors.RESET} SMS fallidos esta sesión", width, C_BORDER))
        print(make_box_line(f"• Conectado a    : {self.backend_url}", width, C_BORDER))
        print(make_box_line(f"• Último Envío   : {self.last_sent_info}", width, C_BORDER))
        print(make_box_line(f"• Actividad      : {Colors.CYAN}{self.current_activity}{Colors.RESET}", width, C_BORDER))

        print(f"{C_BORDER}├{line_str}┤{Colors.RESET}")

        # Sección 3: Bitácora de Eventos en Tiempo Real
        print(make_box_line(f"{Colors.BOLD}{Colors.WHITE}BITÁCORA DE EVENTOS EN TIEMPO REAL{Colors.RESET}", width, C_BORDER))
        logs_to_show = self.recent_events[-6:] if self.recent_events else [f"{Colors.DIM}Esperando primeros eventos de ejecución...{Colors.RESET}"]
        for evt in logs_to_show:
            print(make_box_line(evt, width, C_BORDER))

        print(f"{C_BORDER}└{line_str}┘{Colors.RESET}")

    def execute_adb_command(self, args):
        """
        Ejecuta un comando adb mediante subprocess y retorna stdout o lanza excepción.
        Si hay un serial seleccionado, añade implícitamente '-s <serial>'.
        """
        if self.device_serial and "-s" not in args and args and args[0] != "devices":
            cmd = [self.adb_bin, "-s", self.device_serial] + args
        else:
            cmd = [self.adb_bin] + args

        cmd_str = " ".join(cmd)
        logger.debug(f"[ADB] Comando a ejecutar: {cmd_str}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30
            )
            logger.debug(f"[ADB] Exit Code: {result.returncode}")
            if result.stdout:
                logger.debug(f"[ADB] STDOUT:\n{result.stdout.strip()}")
            if result.stderr:
                logger.debug(f"[ADB] STDERR:\n{result.stderr.strip()}")
            
            if result.returncode != 0:
                err_details = result.stderr.strip() or result.stdout.strip()
                if any(err in err_details.lower() for err in ["device not found", "device offline", "no devices"]):
                    self.log_event("Dispositivo ADB desconectado o no encontrado. Reiniciando selección...", level="WARNING")
                    self.device_serial = None
                raise RuntimeError(f"ADB retornó código {result.returncode}: {err_details}")
            return result.stdout.strip()
        except FileNotFoundError:
            self.log_event("Error: ADB ejecutable no encontrado en el sistema.", level="ERROR")
            raise RuntimeError("ADB ejecutable no encontrado.")
        except Exception as e:
            logger.error(f"[ADB] Error ejecutando ADB ({cmd_str}): {e}", exc_info=True)
            raise

    def get_device_model(self, serial):
        """
        Obtiene el modelo del dispositivo Android para un serial específico.
        """
        try:
            result = subprocess.run(
                [self.adb_bin, "-s", serial, "shell", "getprop", "ro.product.model"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def detect_connected_device(self):
        """
        Detecta los dispositivos conectados vía ADB y solicita la selección manual/confirmación al usuario.
        """
        logger.debug("[DETECT] Verificando lista de dispositivos conectados (adb devices -l)...")
        try:
            output = subprocess.run(
                [self.adb_bin, "devices", "-l"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10
            ).stdout or ""

            lines = [l.strip() for l in output.splitlines() if l.strip()]

            connected_devices = []
            for line in lines:
                if line.startswith("List of devices") or not line:
                    continue
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    serial = parts[0]
                    model = "Dispositivo Android"
                    for part in parts[2:]:
                        if part.startswith("model:"):
                            model = part.split(":", 1)[1]
                            break
                    connected_devices.append({
                        "serial": serial,
                        "model": model
                    })

            if not connected_devices:
                self.device_serial = None
                self.device_status = "offline"
                self.render_dashboard("🔴 Buscando dispositivo ADB USB conectado...")
                return False

            # Si se especificó el serial por parámetro CLI (--serial)
            if self.cli_serial:
                matched = next((d for d in connected_devices if d["serial"] == self.cli_serial), None)
                if matched:
                    self.device_serial = matched["serial"]
                    self.model_name = self.get_device_model(matched["serial"]) or matched["model"]
                    self.device_status = "online"
                    self.log_event(f"Dispositivo preseleccionado vía CLI: {self.model_name} ({mask_serial(self.device_serial)})")
                    return True
                else:
                    self.log_event(f"Serial --serial '{self.cli_serial}' no encontrado en dispositivos USB.", level="WARNING")

            # Mostrar siempre el selector interactivo para confirmar el dispositivo a operar (incluso si solo hay 1)
            os.system('cls' if os.name == 'nt' else 'clear')
            print("\n==========================================================")
            print("    DISPOSITIVOS MÓVILES CONECTADOS VÍA ADB DETECTADOS    ")
            print("==========================================================")
            for idx, dev in enumerate(connected_devices, 1):
                detailed_model = self.get_device_model(dev["serial"]) or dev["model"]
                dev["detailed_model"] = detailed_model
                print(f"  [{idx}] {detailed_model} (Serial Censurado: {mask_serial(dev['serial'])})")
            print("==========================================================")

            while True:
                try:
                    choice_str = input(f"Seleccione el número de dispositivo a operar [1-{len(connected_devices)}]: ").strip()
                    if choice_str.isdigit():
                        idx = int(choice_str) - 1
                        if 0 <= idx < len(connected_devices):
                            selected = connected_devices[idx]
                            self.device_serial = selected["serial"]
                            self.model_name = selected["detailed_model"]
                            self.device_status = "online"
                            last_digits = self.device_serial[-4:] if len(self.device_serial) >= 4 else self.device_serial
                            self.log_event(f"Dispositivo ADB seleccionado: {self.model_name} (Código Web: {last_digits})")
                            return True
                    print(f" Opción no válida. Por favor ingresa un número entre 1 y {len(connected_devices)}.")
                except (KeyboardInterrupt, EOFError):
                    print("\n Operación cancelada por el usuario.")
                    sys.exit(0)

        except Exception as e:
            logger.debug(f"[DETECT] Detalle del fallo en detección: {e}", exc_info=True)
            self.device_serial = None
            self.device_status = "offline"
            return False

    def register_heartbeat(self):
        """
        Envía un ping/heartbeat al Backend para actualizar estado y verificar cuota.
        """
        if not self.device_serial:
            return None

        url = f"{self.backend_url}/device-tasks/register"
        payload = {
            "device_serial": self.device_serial,
            "model_name": self.model_name
        }
        if self.group_id:
            payload["group_id"] = self.group_id

        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.ok:
                data = response.json()
                self.monthly_limit = data.get("monthly_limit", 1000)
                self.monthly_usage = data.get("current_month_usage", 0)
                self.celular_info = data.get("celular_info")
                self.device_status = data.get("status", "online")
                return data
            else:
                self.log_event(f"Error en heartbeat backend ({response.status_code})", level="WARNING")
        except Exception as e:
            self.log_event(f"No se pudo conectar con backend ({self.backend_url}): {e}", level="WARNING")
        return None

    def mark_offline(self):
        """
        Notifica al backend que este dispositivo está offline (apagado o desconectado).
        """
        if not self.device_serial:
            return
        url = f"{self.backend_url}/device-tasks/offline"
        try:
            requests.post(url, json={"device_serial": self.device_serial}, timeout=5)
            self.log_event(f"Dispositivo marcado como OFFLINE en el backend.", level="WARNING")
        except Exception as e:
            logger.debug(f"[OFFLINE] No se pudo notificar offline al backend: {e}")

    def send_sms(self, number, message):
        """
        Lógica para envío de SMS vía ADB mediante Intents y simulación de Tap.
        """
        self.log_event(f"Iniciando envío de SMS a {number} ({len(message)} chars)...")

        safe_message = message.replace("'", r"'\''")
        quoted_message = f"'{safe_message}'"

        # 1. Abrir app SMS
        intent_args = [
            "shell", "am", "start",
            "-a", "android.intent.action.SENDTO",
            "-d", f"sms:{number}",
            "--es", "sms_body", quoted_message
        ]
        self.execute_adb_command(intent_args)
        time.sleep(1.0)

        # 2. Pulsación simulada del botón Enviar (coordenadas 990, 2300)
        self.execute_adb_command([
            "shell", "input", "tap", "990", "2300"
        ])
        time.sleep(3.0)

        sent_time = time.strftime("%H:%M:%S")
        self.session_sent += 1
        self.monthly_usage += 1
        self.last_sent_info = f"{number} ({sent_time})"
        self.log_event(f"SMS enviado exitosamente a {number}", level="SUCCESS")

        return {"status": "ok", "destination": number, "sent_at": time.strftime("%Y-%m-%d %H:%M:%S")}

    def check_sms_answers(self):
        """
        Consulta de respuestas SMS recibidas en la bandeja de entrada vía ADB.
        """
        self.log_event("Consultando bandeja de entrada SMS vía ADB...")
        raw_output = self.execute_adb_command([
            "shell", "content", "query",
            "--uri", "content://sms/inbox",
            "--projection", "_id,address,date,body,type"
        ])

        parsed_messages = self.parse_sms_output(raw_output)
        self.log_event(f"Consulta SMS completada: {len(parsed_messages)} mensajes parseados.", level="SUCCESS")
        return {"messages": parsed_messages, "count": len(parsed_messages)}

    def parse_sms_output(self, output):
        if not output:
            return []

        messages = []
        lines = [l.strip() for l in output.splitlines() if l.strip()]

        for line in lines:
            if not line.startswith("Row:") or "Movistar" in line:
                continue

            id_match = re.search(r'_id=(\d+)', line)
            row_match = re.search(r'Row:\s*(\d+)', line)
            address_match = re.search(r'address=([^,]+)', line)
            body_match = re.search(r'body=([^,]+(?:,[^t]+)?)', line)
            type_match = re.search(r'type=(\d+)', line)
            date_match = re.search(r'date=(\d+)', line)

            msg = {
                "id": int(id_match.group(1)) if id_match else None,
                "row": int(row_match.group(1)) if row_match else None,
                "address": address_match.group(1).strip() if address_match else None,
                "body": body_match.group(1).strip() if body_match else None,
                "type": int(type_match.group(1)) if type_match else None,
                "date": int(date_match.group(1)) if date_match else None,
            }
            messages.append(msg)

        return messages

    def process_task(self, task):
        task_id = task.get("id")
        task_type = task.get("type")
        payload = task.get("payload", {})

        short_id = task_id[:8] if task_id else "N/A"
        self.log_event(f"⚡ Procesando tarea {short_id} ({task_type})...")
        self.update_task_status(task_id, "processing", logs=f"Agente ADB ejecutando tarea {task_type}...")

        try:
            if task_type == "SEND_SMS":
                number = payload.get("number")
                message = payload.get("message")
                if not number or not message:
                    raise ValueError("Se requiere 'number' y 'message' para SEND_SMS.")
                result = self.send_sms(number, message)
                log_msg = f"SMS enviado a {number}."

            elif task_type == "CHECK_SMS_ANSWERS":
                result = self.check_sms_answers()
                log_msg = f"Consulta de respuestas SMS realizada ({result['count']} msgs)."

            else:
                raise ValueError(f"Tipo de tarea desconocido: '{task_type}'")

            self.update_task_status(
                task_id,
                "completed",
                result=result,
                logs=f"{log_msg}\nTarea completada exitosamente por dispositivo {self.device_serial}."
            )

        except Exception as e:
            err_msg = str(e)
            self.session_failed += 1
            self.log_event(f"Falló tarea {short_id}: {err_msg}", level="ERROR")
            self.update_task_status(
                task_id,
                "failed",
                error_message=err_msg,
                logs=f"Error en ejecución ADB: {err_msg}"
            )

    def update_task_status(self, task_id, status, result=None, logs=None, error_message=None):
        url = f"{self.backend_url}/device-tasks/{task_id}/status"
        payload = {
            "status": status,
            "device_serial": self.device_serial,
            "result": result,
            "logs": logs,
            "error_message": error_message
        }
        try:
            requests.patch(url, json=payload, timeout=10)
        except Exception as e:
            logger.debug(f"[UPDATE_STATUS] Error enviando estado: {e}")

    def poll_for_tasks(self):
        url = f"{self.backend_url}/device-tasks/pending"
        params = {"serial": self.device_serial}
        if self.group_id:
            params["groupId"] = self.group_id

        try:
            res = requests.get(url, params=params, timeout=10)
            if not res.ok:
                return

            data = res.json()
            if data.get("quota_exceeded"):
                self.log_event(f"CUOTA SUPERADA: {data.get('message')}", level="WARNING")
                return

            task = data.get("task")
            if task:
                self.process_task(task)

        except requests.exceptions.ConnectionError:
            self.log_event(f"Sin conexión con Backend NestJS en {self.backend_url}", level="WARNING")
        except Exception as e:
            logger.debug(f"[POLLING] Error: {e}")

    def run(self):
        self.render_dashboard("Iniciando Agente Local ADB...")

        try:
            while True:
                try:
                    # 1. Detectar y seleccionar dispositivo
                    if not self.device_serial:
                        if not self.detect_connected_device():
                            time.sleep(POLL_INTERVAL_SECONDS)
                            continue

                    # 2. Verificar estado ADB
                    try:
                        adb_check = subprocess.run(
                            [self.adb_bin, "-s", self.device_serial, "get-state"],
                            capture_output=True, text=True, timeout=5
                        )
                        if adb_check.returncode != 0 or "device" not in adb_check.stdout:
                            self.log_event(f"Dispositivo {mask_serial(self.device_serial)} desconectado en ADB.", level="WARNING")
                            self.mark_offline()
                            self.device_serial = None
                            self.model_name = None
                            time.sleep(POLL_INTERVAL_SECONDS)
                            continue
                    except Exception:
                        self.mark_offline()
                        self.device_serial = None
                        self.model_name = None
                        time.sleep(POLL_INTERVAL_SECONDS)
                        continue

                    # 3. Heartbeat y cuota
                    dev_info = self.register_heartbeat()
                    if dev_info and dev_info.get("status") == "quota_exceeded":
                        self.log_event(f"Cuota mensual agotada ({self.monthly_usage}/{self.monthly_limit} SMS).", level="WARNING")
                        time.sleep(POLL_INTERVAL_SECONDS * 3)
                        continue

                    # 4. Polling de tareas pendientes
                    self.render_dashboard("Esperando tareas en cola...")
                    self.poll_for_tasks()

                except Exception as e:
                    self.log_event(f"Excepción en bucle principal: {e}", level="ERROR")

                time.sleep(POLL_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            self.log_event("Deteniendo Agente Local ADB...", level="WARNING")
            self.mark_offline()
            sys.exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agente Local ADB - Control de Dispositivos Móviles")
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL, help="URL del backend NestJS (ej. http://localhost:3000)")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="Nivel de detalle de los logs")
    parser.add_argument("--serial", "-s", default=None, help="Número de serie del dispositivo ADB")
    parser.add_argument("--group-id", "-g", default=os.environ.get("GROUP_ID"), help="ID del grupo/establecimiento")
    args = parser.parse_args()

    target_level = getattr(logging, args.log_level.upper(), logging.INFO)
    logger.setLevel(target_level)

    agent = ADBDeviceAgent(backend_url=args.backend_url, cli_serial=args.serial, group_id=args.group_id)
    agent.run()

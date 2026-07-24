# Módulo Local ADB - Agente de Control Móvil

Este ejecutable corre en la PC local del usuario y conecta el Backend ERP (NestJS) con el teléfono celular conectado por USB vía ADB.

---

## 📋 Requisitos Previos en la PC del Usuario

1. **Android Debug Bridge (ADB)**:
   - Descargar e instalar las herramientas ADB ([Platform Tools de Android](https://developer.android.com/studio/releases/platform-tools)).
   - Asegurarse de que `adb` esté agregado a la variable de entorno `PATH`.
2. **Dispositivo Móvil**:
   - Activar las **Opciones de Desarrollador** en el teléfono Android.
   - Habilitar la opción **Depuración por USB (USB Debugging)**.
   - Conectar por cable USB a la PC y permitir la autorización permanente ("Permitir siempre desde esta computadora").

---

## 🚀 Ejecución en Modo Desarrollo (Python)

1. Crear un entorno virtual e instalar las dependencias:
   ```bash
   python -m venv venv
   # En Windows:
   venv\Scripts\activate
   # En Linux/Mac:
   source venv/bin/activate

   pip install -r requirements.txt
   ```

2. Ejecutar el script:
   ```bash
   python agent.py
   ```
   *(Opcionalmente se puede definir `set BACKEND_URL=http://tu-servidor-nestjs:3000`)*

---

## 📦 Compilación a Ejecutable `.exe` con PyInstaller

Para generar un único ejecutable distribuible sin requerir Python instalado en la máquina final:

```bash
pyinstaller --onefile --name "ADB_Mobile_Agent" agent.py
```

El ejecutable resultante se guardará en la carpeta `dist/ADB_Mobile_Agent.exe`.

---

## 🛡️ Control de Cuotas Mensuales (Límite 1000 SMS/mes)

- Cada dispositivo móvil es identificado automáticamente por su **Serial ADB** (`adb get-serialno`).
- El backend registra la cuota consumida durante el mes calendario.
- Al alcanzar los **1000 SMS**, el agente pausará automáticamente el procesamiento de nuevas tareas de envío para dicho dispositivo, evitando cobros involuntarios o bloqueos de operadora, e informando el estado a la interfaz web.

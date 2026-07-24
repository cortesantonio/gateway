-- Migración: Registro de Dispositivos y Cola de Tareas Distribuida ADB
-- Fecha: 2026-07-23

-- 1. Tabla de Dispositivos Registrados
CREATE TABLE IF NOT EXISTS registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_serial VARCHAR(100) UNIQUE NOT NULL,
    model_name VARCHAR(150),
    status VARCHAR(30) DEFAULT 'online' CHECK (status IN ('online', 'offline', 'busy', 'quota_exceeded')),
    monthly_limit INT DEFAULT 1000 NOT NULL,
    current_month_usage INT DEFAULT 0 NOT NULL,
    last_reset_month VARCHAR(7) NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM'),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registered_devices_serial ON registered_devices(device_serial);

-- 2. Tabla de Cola de Tareas Distribuida (Device Tasks)
CREATE TABLE IF NOT EXISTS device_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_serial VARCHAR(100) REFERENCES registered_devices(device_serial) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL, -- ej: 'SEND_SMS', 'CHECK_SMS_ANSWERS'
    payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    result JSONB DEFAULT '{}'::jsonb,
    logs TEXT DEFAULT '',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tasks_status ON device_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_device_tasks_serial ON device_tasks(device_serial);

-- 3. Función trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_device_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_device_tasks_timestamp ON device_tasks;
CREATE TRIGGER trg_update_device_tasks_timestamp
    BEFORE UPDATE ON device_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_device_tasks_timestamp();

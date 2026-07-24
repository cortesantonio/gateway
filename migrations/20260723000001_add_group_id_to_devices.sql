-- Migración: Añadir group_id para aislar dispositivos y tareas por establecimiento/grupo
ALTER TABLE registered_devices ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE device_tasks ADD COLUMN IF NOT EXISTS group_id UUID;

CREATE INDEX IF NOT EXISTS idx_registered_devices_group ON registered_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_device_tasks_group ON device_tasks(group_id);

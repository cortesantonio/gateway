-- Migración: Registro de eventos de Webhook WhatsApp (Evoluziona / Meta)
-- Fecha: 2026-11-11

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedup_key VARCHAR(255) UNIQUE,
    event VARCHAR(50) NOT NULL, -- 'message.status' | 'message.received'
    notification_id BIGINT REFERENCES notificacion_cita(id) ON DELETE SET NULL,
    request_id VARCHAR(150),
    message_id VARCHAR(150),
    status VARCHAR(50), -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
    from_number VARCHAR(50),
    our_number VARCHAR(50),
    message_type VARCHAR(50),
    text_content TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    event_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_notification_id ON whatsapp_webhook_events(notification_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_request_id ON whatsapp_webhook_events(request_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_from_number ON whatsapp_webhook_events(from_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_created_at ON whatsapp_webhook_events(created_at DESC);


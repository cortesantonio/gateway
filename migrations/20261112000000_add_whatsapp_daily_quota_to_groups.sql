-- Migración: Cuota diaria de envíos WhatsApp API por grupo
-- Fecha: 2026-11-12

ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS whatsapp_daily_limit INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS whatsapp_daily_usage INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS whatsapp_usage_date DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Santiago')::date);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_groups_whatsapp_daily_limit_non_negative'
    ) THEN
        ALTER TABLE groups
            ADD CONSTRAINT chk_groups_whatsapp_daily_limit_non_negative
            CHECK (whatsapp_daily_limit >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_groups_whatsapp_daily_usage_non_negative'
    ) THEN
        ALTER TABLE groups
            ADD CONSTRAINT chk_groups_whatsapp_daily_usage_non_negative
            CHECK (whatsapp_daily_usage >= 0);
    END IF;
END $$;

-- Consume atómicamente p_count mensajes del cupo diario de un grupo (zona horaria Chile).
CREATE OR REPLACE FUNCTION consume_whatsapp_group_quota(
    p_group_id UUID,
    p_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
    v_group RECORD;
    v_current_usage INTEGER;
    v_new_usage INTEGER;
BEGIN
    IF p_count IS NULL OR p_count < 1 THEN
        p_count := 1;
    END IF;

    SELECT id, unidad, whatsapp_daily_limit, whatsapp_daily_usage, whatsapp_usage_date
      INTO v_group
      FROM groups
     WHERE id = p_group_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'not_found', true,
            'group_id', p_group_id
        );
    END IF;

    IF v_group.whatsapp_usage_date IS DISTINCT FROM v_today THEN
        v_current_usage := 0;
    ELSE
        v_current_usage := COALESCE(v_group.whatsapp_daily_usage, 0);
    END IF;

    IF COALESCE(v_group.whatsapp_daily_limit, 0) <= 0
       OR (v_current_usage + p_count) > v_group.whatsapp_daily_limit THEN
        IF v_group.whatsapp_usage_date IS DISTINCT FROM v_today THEN
            UPDATE groups
               SET whatsapp_daily_usage = 0,
                   whatsapp_usage_date = v_today
             WHERE id = p_group_id;
        END IF;

        RETURN jsonb_build_object(
            'allowed', false,
            'not_found', false,
            'group_id', v_group.id,
            'group_name', COALESCE(v_group.unidad, 'Grupo'),
            'daily_limit', COALESCE(v_group.whatsapp_daily_limit, 0),
            'daily_usage', v_current_usage,
            'remaining', GREATEST(0, COALESCE(v_group.whatsapp_daily_limit, 0) - v_current_usage),
            'usage_date', v_today::text
        );
    END IF;

    v_new_usage := v_current_usage + p_count;

    UPDATE groups
       SET whatsapp_daily_usage = v_new_usage,
           whatsapp_usage_date = v_today
     WHERE id = p_group_id;

    RETURN jsonb_build_object(
        'allowed', true,
        'not_found', false,
        'group_id', v_group.id,
        'group_name', COALESCE(v_group.unidad, 'Grupo'),
        'daily_limit', v_group.whatsapp_daily_limit,
        'daily_usage', v_new_usage,
        'remaining', GREATEST(0, v_group.whatsapp_daily_limit - v_new_usage),
        'usage_date', v_today::text
    );
END;
$$;

-- Reembolsa cupo si el proveedor externo falla antes de encolar el mensaje.
CREATE OR REPLACE FUNCTION refund_whatsapp_group_quota(
    p_group_id UUID,
    p_count INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
BEGIN
    IF p_count IS NULL OR p_count < 1 THEN
        p_count := 1;
    END IF;

    UPDATE groups
       SET whatsapp_daily_usage = GREATEST(0, whatsapp_daily_usage - p_count)
     WHERE id = p_group_id
       AND whatsapp_usage_date = v_today;
END;
$$;


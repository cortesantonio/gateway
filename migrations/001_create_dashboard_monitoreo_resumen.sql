-- Migration: create_dashboard_monitoreo_resumen_view
-- Description: Creates a summary view that aggregates notificacion_cita data
--              to avoid the 53K+ row full-table download every 5 minutes.
-- Date: 2026-05-08

CREATE OR REPLACE VIEW public.dashboard_monitoreo_resumen AS
SELECT
  COALESCE(establecimiento, 'Sin Establecimiento') AS establecimiento,
  estado_envio,
  estado_confirmacion,
  COUNT(*) AS total
FROM public.notificacion_cita
WHERE activo = true
GROUP BY
  COALESCE(establecimiento, 'Sin Establecimiento'),
  estado_envio,
  estado_confirmacion;

-- Grant access to the view for authenticated and service_role users
GRANT SELECT ON public.dashboard_monitoreo_resumen TO authenticated;
GRANT SELECT ON public.dashboard_monitoreo_resumen TO service_role;

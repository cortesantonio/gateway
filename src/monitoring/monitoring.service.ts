import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../auth/supabase.service';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  /** Caché on-demand: se llena en la primera solicitud y dura 30 min */
  private cachedData: any[] | null = null;
  private cacheTimestamp: number = 0;

  constructor(
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Devuelve datos planos de notificacion_cita.
   * Usa un caché en memoria de 30 minutos para evitar consultas repetitivas.
   * Si el caché está vigente, lo retorna directamente.
   */
  async getFlatAppointments(): Promise<{ data: any[]; cachedAt: string }> {
    const now = Date.now();

    if (this.cachedData && (now - this.cacheTimestamp) < CACHE_TTL_MS) {
      const ageMin = Math.round((now - this.cacheTimestamp) / 60000);
      this.logger.log(`Retornando datos desde caché (antigüedad: ${ageMin} min)`);
      return {
        data: this.cachedData,
        cachedAt: new Date(this.cacheTimestamp).toISOString(),
      };
    }

    const data = await this.fetchAndCache();
    return {
      data,
      cachedAt: new Date(this.cacheTimestamp).toISOString(),
    };
  }

  /**
   * Fuerza una recarga de datos desde Supabase, invalidando el caché actual.
   * Llamado desde el endpoint POST /monitoring/refresh.
   */
  async refreshData(): Promise<{ totalRecords: number; cachedAt: string }> {
    const data = await this.fetchAndCache();
    return {
      totalRecords: data.length,
      cachedAt: new Date(this.cacheTimestamp).toISOString(),
    };
  }

  /**
   * Consulta Supabase con paginación y guarda en caché.
   */
  private async fetchAndCache(): Promise<any[]> {
    try {
      this.logger.log('Consultando datos planos desde Supabase...');
      const supabase = this.supabaseService.getAdminClient();
      let allAppointments: any[] = [];
      let hasMore = true;
      let page = 0;
      const limit = 1000;

      while (hasMore) {
        const startRange = page * limit;
        const endRange = startRange + limit - 1;

        const { data, error } = await supabase
          .from('notificacion_cita')
          .select('establecimiento, estado_envio, estado_confirmacion, created_at, fecha_envio, fecha_confirmacion, nombre_paciente, fecha_cita, hora_cita, link_opened_at, tipo_atencion')
          .eq('activo', true)
          .range(startRange, endRange);

        if (error) throw error;

        if (data && data.length > 0) {
          allAppointments = allAppointments.concat(data);
        }

        if (!data || data.length < limit) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Actualizar caché
      this.cachedData = allAppointments;
      this.cacheTimestamp = Date.now();

      this.logger.log(`Datos actualizados y cacheados. Total: ${allAppointments.length} registros (TTL: 30 min)`);
      return allAppointments;
    } catch (error) {
      this.logger.error('Error obteniendo datos planos:', error);
      throw error;
    }
  }
}

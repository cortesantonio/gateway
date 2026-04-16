import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { SupabaseService } from '../auth/supabase.service';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private flatAppointments: any[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async onModuleInit() {
    this.logger.log('Inicializando caché de datos planos...');
    await this.syncAllData();
    
    // Actualizar cada 5 minutos
    this.syncInterval = setInterval(() => {
      this.syncAllData();
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  private async syncAllData() {
    try {
      this.logger.log('Sincronizando todas las citas desde Supabase...');
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

      this.flatAppointments = allAppointments;
      this.logger.log(`Sincronización completa. Registros en memoria: ${this.flatAppointments.length}`);
    } catch (error) {
      this.logger.error('Error sincronizando datos planos:', error);
    }
  }

  async getMonitoringStats(startDate: string, endDate: string) {
    const cacheKey = `monitoring_stats_${startDate}_${endDate}`;
    const cachedData = await this.cacheManager.get(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    // Filtrar los datos planos que ya tenemos en memoria
    const filteredAppointments = this.flatAppointments.filter(app => {
      if (!app.created_at) return false;
      const createdAt = app.created_at;
      return createdAt >= `${startDate}T00:00:00` && createdAt <= `${endDate}T23:59:59`;
    });

    if (filteredAppointments.length === 0) return this.getEmptyStats();

    const stats = this.calculateStatsFromData(filteredAppointments, startDate, endDate);
    
    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, stats, 5 * 60 * 1000);
    
    return stats;
  }

  getFlatAppointments() {
    return this.flatAppointments;
  }

  private calculateStatsFromData(allAppointments: any[], startDate: string, endDate: string) {

    // Global Statistics
    const totalCargadas = allAppointments.length;
    const enviadas = allAppointments.filter(a => a.estado_envio === 'enviado');
    const totalEnviadas = enviadas.length;
    
    const confirmed = enviadas.filter(a => a.estado_confirmacion === 'confirmado').length;
    const rejected = enviadas.filter(a => a.estado_confirmacion === 'rechazado').length;
    const pending = enviadas.filter(a => a.estado_confirmacion === 'pendiente').length;
    const noResponse = enviadas.filter(a => a.estado_confirmacion === 'no_responde').length;
    const notSent = totalCargadas - totalEnviadas;
    const contactRate = totalEnviadas > 0 ? Math.round(((confirmed + rejected) / totalEnviadas) * 100) : 0;

    const stats = {
      totalCargadas,
      total: totalEnviadas,
      confirmed,
      rejected,
      pending,
      noResponse,
      notSent,
      contactRate
    };

    // Group By Establishment
    const byEstablishment: Record<string, any> = {};
    allAppointments.forEach(app => {
      const name = app.establecimiento || 'Sin Establecimiento';
      if (!byEstablishment[name]) {
        byEstablishment[name] = { totalCargadas: 0, total: 0, confirmed: 0, rejected: 0, pending: 0, noResponse: 0 };
      }
      byEstablishment[name].totalCargadas++;
      if (app.estado_envio === 'enviado') {
        byEstablishment[name].total++;
        if (app.estado_confirmacion === 'confirmado') byEstablishment[name].confirmed++;
        else if (app.estado_confirmacion === 'rechazado') byEstablishment[name].rejected++;
        else if (app.estado_confirmacion === 'pendiente') byEstablishment[name].pending++;
        else if (app.estado_confirmacion === 'no_responde') byEstablishment[name].noResponse++;
      }
    });

    // Daily Trends
    const daysInRange = this.getDaysInRange(startDate, endDate);
    const dailyCreation = daysInRange.map(date => ({
      date,
      count: allAppointments.filter(a => a.created_at.startsWith(date)).length
    }));

    const dailyCreationByEstablishment: Record<string, any> = {};
    Object.keys(byEstablishment).forEach(est => {
      dailyCreationByEstablishment[est] = daysInRange.map(date => ({
        date,
        count: allAppointments.filter(a => a.establecimiento === est && a.created_at.startsWith(date)).length
      }));
    });

    const dailyActivity = daysInRange.map(date => ({
      date,
      sent: allAppointments.filter(a => a.estado_envio === 'enviado' && a.fecha_envio?.startsWith(date)).length,
      confirmed: allAppointments.filter(a => a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion?.startsWith(date)).length,
      rejected: allAppointments.filter(a => a.estado_confirmacion === 'rechazado' && a.fecha_confirmacion?.startsWith(date)).length,
    }));

    const activityByEstablishmentDaily: Record<string, any> = {};
    Object.keys(byEstablishment).forEach(est => {
      activityByEstablishmentDaily[est] = daysInRange.map(date => ({
        date,
        sent: allAppointments.filter(a => a.establecimiento === est && a.estado_envio === 'enviado' && a.fecha_envio?.startsWith(date)).length,
        confirmed: allAppointments.filter(a => a.establecimiento === est && a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion?.startsWith(date)).length,
        rejected: allAppointments.filter(a => a.establecimiento === est && a.estado_confirmacion === 'rechazado' && a.fecha_confirmacion?.startsWith(date)).length,
      }));
    });

    // Recent Activity
    const recentActivity = allAppointments
      .filter(a => a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion)
      .sort((a, b) => new Date(b.fecha_confirmacion).getTime() - new Date(a.fecha_confirmacion).getTime())
      .slice(0, 10)
      .map(this.mapToFrontend);

    const recentNotifications = allAppointments
      .filter(a => a.estado_envio === 'enviado' && a.fecha_envio)
      .sort((a, b) => new Date(b.fecha_envio).getTime() - new Date(a.fecha_envio).getTime())
      .slice(0, 10)
      .map(this.mapToFrontend);

    const recentCreatedAppointments = [...allAppointments]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
      .map(this.mapToFrontend);

    return {
      stats,
      byEstablishment,
      recentActivity,
      recentNotifications,
      recentCreatedAppointments,
      dailyCreation,
      dailyCreationByEstablishment,
      dailyActivity,
      activityByEstablishmentDaily
    };
  }

  private mapToFrontend(item: any) {
    return {
      id: item.id,
      nombrePaciente: item.nombre_paciente,
      fechaCita: item.fecha_cita,
      horaCita: item.hora_cita,
      establecimiento: item.establecimiento,
      estadoConfirmacion: item.estado_confirmacion,
      estadoEnvio: item.estado_envio,
      fechaConfirmacion: item.fecha_confirmacion,
      fechaEnvio: item.fecha_envio,
      createdAt: item.created_at,
      linkOpenedAt: item.link_opened_at
    };
  }

  private getDaysInRange(start: string, end: string) {
    const days: string[] = [];
    let current = new Date(start);
    const last = new Date(end);
    while (current <= last) {
      days.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  private getEmptyStats() {
    return {
      stats: { totalCargadas: 0, total: 0, confirmed: 0, rejected: 0, pending: 0, noResponse: 0, notSent: 0, contactRate: 0 },
      byEstablishment: {},
      recentActivity: [],
      recentNotifications: [],
      recentCreatedAppointments: [],
      dailyCreation: [],
      dailyCreationByEstablishment: {},
      dailyActivity: [],
      activityByEstablishmentDaily: {}
    };
  }
}

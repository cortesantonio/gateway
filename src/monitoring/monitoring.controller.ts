import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('monitoring')
@UseGuards(SupabaseAuthGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('flat-data')
  getFlatData() {
    return this.monitoringService.getFlatAppointments();
  }

  /**
   * Fuerza la actualización del caché de datos de monitoreo.
   * Invalida el caché actual y recarga desde Supabase.
   */
  @Post('refresh')
  async refresh() {
    return this.monitoringService.refreshData();
  }
}

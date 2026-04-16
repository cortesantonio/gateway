import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('monitoring')
@UseGuards(SupabaseAuthGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('stats')
  async getStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required');
    }
    return this.monitoringService.getMonitoringStats(startDate, endDate);
  }

  @Get('flat-data')
  getFlatData() {
    return this.monitoringService.getFlatAppointments();
  }
}

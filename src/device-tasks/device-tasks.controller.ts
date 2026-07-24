import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DeviceTasksService } from './device-tasks.service';
import {
  RegisterDeviceDto,
  CreateTaskDto,
  UpdateTaskStatusDto,
  VerifyLinkDeviceDto,
} from './device-tasks.types';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('device-tasks')
export class DeviceTasksController {
  constructor(private readonly deviceTasksService: DeviceTasksService) {}

  /**
   * Registro o heartbeat del script local de Python.
   */
  @Post('register')
  async registerHeartbeat(@Body() dto: RegisterDeviceDto) {
    return this.deviceTasksService.registerHeartbeat(dto);
  }

  /**
   * El agente local notifica que el dispositivo se desconectó o el agente se apagó.
   * No requiere JWT porque lo llama el script local (sin sesión web).
   */
  @Post('offline')
  async markOffline(@Body('device_serial') device_serial: string) {
    if (!device_serial) return { ok: false, message: 'Se requiere device_serial.' };
    await this.deviceTasksService.markDeviceOffline(device_serial);
    return { ok: true };
  }

  /**
   * Obtener dispositivos conectados y métricas de cuotas mensuales.
   * Filtra por el grupo/establecimiento si se proporciona `groupId`.
   */
  @Get('devices')
  @UseGuards(SupabaseAuthGuard)
  async listDevices(@Query('groupId') groupId?: string) {
    return this.deviceTasksService.listDevices(groupId);
  }

  /**
   * Encolar manualmente notificaciones de citas seleccionadas por el usuario para envío SMS.
   */
  @Post('queue-selected-appointments')
  @UseGuards(SupabaseAuthGuard)
  async queueSelectedAppointments(
    @Body('notification_ids') notificationIds: string[],
    @Body('device_serial') device_serial?: string,
    @Body('group_id') groupId?: string,
    @Body('messages') messages?: Record<string, string>,
  ) {
    return this.deviceTasksService.queueSelectedAppointments(notificationIds, device_serial, groupId, messages);
  }

  /**
   * Crear nueva tarea manual desde el Frontend.
   */
  @Post()
  @UseGuards(SupabaseAuthGuard)
  async createTask(@Body() dto: CreateTaskDto) {
    return this.deviceTasksService.createTask(dto);
  }

  /**
   * Verificar posesión y vincular un dispositivo detectado sin grupo al establecimiento del usuario.
   * El backend valida que los últimos 4 dígitos coincidan con el serial real del dispositivo.
   */
  @Post('devices/verify-link')
  @UseGuards(SupabaseAuthGuard)
  async verifyAndLinkDevice(@Body() dto: VerifyLinkDeviceDto) {
    return this.deviceTasksService.verifyAndLinkDevice(dto);
  }

  /**
   * Endpoint de polling para el agente Python.
   * Obtiene la siguiente tarea pendiente si la cuota lo permite.
   */
  @Get('pending')
  async getNextPendingTask(
    @Query('serial') serial: string,
    @Query('groupId') groupId?: string,
  ) {
    if (!serial) {
      return { task: null, message: 'Se requiere el parámetro serial.' };
    }
    return this.deviceTasksService.getNextPendingTask(serial, groupId);
  }

  /**
   * Actualizar estado, logs y resultados de una tarea ejecutada por el agente local.
   */
  @Patch(':id/status')
  async updateTaskStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.deviceTasksService.updateTaskStatus(id, dto);
  }

  /**
   * Consultar estado en tiempo real de una tarea desde la web.
   */
  @Get(':id')
  @UseGuards(SupabaseAuthGuard)
  async getTask(@Param('id') id: string) {
    return this.deviceTasksService.getTask(id);
  }
}

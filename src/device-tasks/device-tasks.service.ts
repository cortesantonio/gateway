import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../auth/supabase.service';
import {
  RegisterDeviceDto,
  CreateTaskDto,
  UpdateTaskStatusDto,
  VerifyLinkDeviceDto,
  DeviceRecord,
} from './device-tasks.types';

@Injectable()
export class DeviceTasksService {
  private readonly logger = new Logger(DeviceTasksService.name);

  constructor(private readonly supabaseService: SupabaseService) { }

  /**
   * Registra o actualiza un dispositivo local con su heartbeat (ping).
   * Restablece la cuota mensual si el mes calendario cambió.
   */
  /**
   * Registra o actualiza un dispositivo local con su heartbeat (ping).
   * Restablece la cuota mensual si el mes calendario cambió.
   */
  async registerHeartbeat(dto: RegisterDeviceDto): Promise<DeviceRecord> {
    const { device_serial, model_name, group_id } = dto;
    const currentMonth = new Date().toISOString().slice(0, 7); // ej: "2026-07"
    const client = this.supabaseService.getAdminClient();

    // 1. Buscar si existe el dispositivo
    const { data: existing } = await client
      .from('registered_devices')
      .select('*')
      .eq('device_serial', device_serial)
      .maybeSingle();

    if (existing) {
      // Si cambió el mes calendario, reiniciar contador
      const isNewMonth = existing.last_reset_month !== currentMonth;
      const newUsage = isNewMonth ? 0 : existing.current_month_usage;
      const isOverQuota = newUsage >= (existing.monthly_limit || 1000);
      const newStatus = isOverQuota ? 'quota_exceeded' : 'online';

      const updateData: any = {
        model_name: model_name || existing.model_name,
        current_month_usage: newUsage,
        last_reset_month: currentMonth,
        status: newStatus,
        last_seen_at: new Date().toISOString(),
      };
      if (group_id) updateData.group_id = group_id;

      const { data: updated, error } = await client
        .from('registered_devices')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);

      const { data: matchedCelular } = await client
        .from('celulares')
        .select('serial_number, marca, modelo, numero, nombre_completo, id_establecimiento, estado')
        .eq('serial_number', device_serial)
        .eq('activo', true)
        .maybeSingle();

      return {
        ...updated,
        celular_info: matchedCelular || undefined,
      };
    } else {
      // Crear nuevo registro de dispositivo
      const { data: created, error } = await client
        .from('registered_devices')
        .insert({
          device_serial,
          model_name: model_name || 'Dispositivo ADB Genérico',
          group_id: group_id || null,
          monthly_limit: 1000,
          current_month_usage: 0,
          last_reset_month: currentMonth,
          status: 'online',
          last_seen_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);

      const { data: matchedCelular } = await client
        .from('celulares')
        .select('serial_number, marca, modelo, numero, nombre_completo, id_establecimiento, estado')
        .eq('serial_number', device_serial)
        .eq('activo', true)
        .maybeSingle();

      return {
        ...created,
        celular_info: matchedCelular || undefined,
      };
    }
  }

  /**
   * Obtiene la lista de dispositivos filtrando por grupo.
   * - Dispositivos vinculados al grupo (group_id === groupId): se devuelve el serial completo.
   * - Dispositivos sin grupo (group_id IS NULL): se devuelve solo el serial censurado.
   * El serial completo NUNCA se expone para dispositivos no vinculados.
   */
  async listDevices(groupId?: string): Promise<DeviceRecord[]> {
    const client = this.supabaseService.getAdminClient();
    let query = client
      .from('registered_devices')
      .select('*')
      .order('last_seen_at', { ascending: false });

    if (groupId) {
      query = query.or(`group_id.eq.${groupId},group_id.is.null`);
    }

    const { data: devices, error } = await query;
    if (error) throw new BadRequestException(error.message);
    if (!devices || devices.length === 0) return [];

    // Cruzar información con la tabla `celulares` por serial_number
    const serials = devices.map((d) => d.device_serial);
    const { data: dbCelulares } = await client
      .from('celulares')
      .select('marca, modelo, numero, nombre_completo, id_establecimiento, estado, serial_number')
      .in('serial_number', serials)
      .eq('activo', true);

    const celularesMap = new Map((dbCelulares || []).map((c) => [c.serial_number, c]));

    return devices.map((dev) => {
      const isLinked = !!dev.group_id && String(dev.group_id) === String(groupId);
      const maskedSerial = this.maskSerialSuffix(dev.device_serial);
      const cel = celularesMap.get(dev.device_serial);

      // Enmascarar siempre los últimos 4 dígitos del número de teléfono
      const maskedNumero = cel?.numero
        ? cel.numero.length > 4
          ? cel.numero.slice(0, -4) + '••••'
          : '••••'
        : undefined;

      return {
        ...dev,
        // Para dispositivos no vinculados, el serial completo se oculta
        device_serial: isLinked ? dev.device_serial : maskedSerial,
        masked_serial: maskedSerial,
        is_linked: isLinked,
        celular_info: cel
          ? {
            marca: cel.marca,
            modelo: cel.modelo,
            nombre_completo: cel.nombre_completo,
            id_establecimiento: cel.id_establecimiento,
            estado: cel.estado,
            numero: maskedNumero,
            // serial_number NUNCA se expone al frontend
          }
          : undefined,
      };
    });
  }

  /**
   * Verifica los últimos 4 dígitos del serial del dispositivo (código de posesión) y lo vincula al grupo.
   * El serial completo no se expone al frontend; la validación ocurre exclusivamente en el backend.
   * Si el dispositivo ya está vinculado al mismo grupo y el código es correcto, retorna sin error.
   */
  async verifyAndLinkDevice(dto: VerifyLinkDeviceDto): Promise<DeviceRecord> {
    const { masked_serial, verification_code, group_id } = dto;
    const client = this.supabaseService.getAdminClient();

    // La columna group_id es bigint → convertir a número
    const groupIdNum = parseInt(String(group_id), 10);
    if (isNaN(groupIdNum)) {
      throw new BadRequestException('El group_id proporcionado no es un número válido.');
    }

    // El masked_serial tiene la forma "XXXXXXXXXX••••"; extraemos el prefijo visible
    const visiblePrefix = masked_serial.replace(/[•]+$/, '');
    const normalizedCode = verification_code.trim().toLowerCase();

    // Buscar candidatos: dispositivos sin grupo O ya vinculados al mismo grupo
    // (permite re-verificar si el dispositivo ya estaba vinculado)
    const { data: candidates, error } = await client
      .from('registered_devices')
      .select('*')
      .ilike('device_serial', `${visiblePrefix}%`)
      .or(`group_id.is.null,group_id.eq.${groupIdNum}`);

    if (error) throw new BadRequestException(error.message);

    const matched = (candidates || []).find(
      (d) => d.device_serial.slice(-4).toLowerCase() === normalizedCode,
    );

    if (!matched) {
      throw new ForbiddenException(
        'Código de verificación incorrecto. Revisa los 4 dígitos que aparecen en la consola del agente local.',
      );
    }

    // Si ya está vinculado al mismo grupo, retornar sin modificar
    if (matched.group_id && String(matched.group_id) === String(groupIdNum)) {
      this.logger.log(`Dispositivo ${this.maskSerialSuffix(matched.device_serial)} ya estaba vinculado al grupo ${groupIdNum}`);
      const maskedSerial = this.maskSerialSuffix(matched.device_serial);
      return {
        ...matched,
        device_serial: matched.device_serial,
        masked_serial: maskedSerial,
        is_linked: true,
      };
    }

    // Vincular el dispositivo al grupo (bigint)
    const { data: updated, error: updateError } = await client
      .from('registered_devices')
      .update({ group_id: groupIdNum })
      .eq('id', matched.id)
      .select()
      .single();

    if (updateError) throw new BadRequestException(updateError.message);

    this.logger.log(`Dispositivo ${this.maskSerialSuffix(matched.device_serial)} vinculado al grupo ${groupIdNum}`);

    const maskedSerial = this.maskSerialSuffix(updated.device_serial);
    return {
      ...updated,
      device_serial: updated.device_serial,
      masked_serial: maskedSerial,
      is_linked: true,
    };
  }

  /** Enmascara los últimos 4 dígitos de un serial (ej: "A65JUT4C2300••••") */
  private maskSerialSuffix(serial: string): string {
    if (!serial || serial.length <= 4) return '••••';
    return serial.slice(0, -4) + '••••';
  }

  /**
   * Encola manualmente una lista de notificaciones de citas seleccionadas por el usuario.
   */
  async queueSelectedAppointments(
    notificationIds: string[],
    device_serial?: string,
    groupId?: string,
    messages?: Record<string, string>,
  ) {
    if (!notificationIds || notificationIds.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos una cita para enviar por SMS.');
    }

    const client = this.supabaseService.getAdminClient();

    // 1. Validar cuota si se especifica un dispositivo
    if (device_serial) {
      const { data: device } = await client
        .from('registered_devices')
        .select('*')
        .eq('device_serial', device_serial)
        .maybeSingle();

      if (device) {
        const quotaLeft = device.monthly_limit - device.current_month_usage;
        if (quotaLeft <= 0) {
          throw new BadRequestException(
            `El dispositivo (${device_serial}) alcanzó su límite de ${device.monthly_limit} SMS/mes.`
          );
        }
        if (notificationIds.length > quotaLeft) {
          throw new BadRequestException(
            `Solo dispone de ${quotaLeft} SMS restantes este mes en este dispositivo (intentó encolar ${notificationIds.length}).`
          );
        }

        // Si el dispositivo aún no tiene asignado un grupo, vincularlo al grupo de la solicitud
        if (!device.group_id && groupId) {
          const groupIdNum = parseInt(String(groupId), 10);
          if (!isNaN(groupIdNum)) {
            await client
              .from('registered_devices')
              .update({ group_id: groupIdNum })
              .eq('id', device.id);
          }
        }
      }
    }

    // Convertir IDs a números/strings válidos para notificacion_cita
    const parsedNotificationIds = notificationIds.map((id) =>
      isNaN(Number(id)) ? id : Number(id),
    );

    // 2. Obtener los registros de las citas seleccionadas
    const { data: selectedAppointments, error: fetchError } = await client
      .from('notificacion_cita')
      .select('*')
      .in('id', parsedNotificationIds);

    if (fetchError) {
      this.logger.error(`Error obteniendo citas seleccionadas: ${fetchError.message}`);
      throw new BadRequestException(fetchError.message);
    }

    if (!selectedAppointments || selectedAppointments.length === 0) {
      throw new BadRequestException('No se encontraron las citas seleccionadas.');
    }

    const queuedTasks: any[] = [];
    const isUuid = (val: any) =>
      typeof val === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // 3. Encolar cada cita en device_tasks
    for (const appt of selectedAppointments) {
      const phoneNumber = appt.telefono_paciente || appt.telefono;
      const customMessage = messages?.[String(appt.id)] || messages?.[appt.id];
      const smsMessage = customMessage || appt.mensaje || appt.nota || `Recordatorio de cita médica para ${appt.nombre_paciente || 'paciente'}.`;

      if (!phoneNumber) continue;

      const rawGroupId = groupId || appt.group_id || null;
      // device_tasks.group_id es de tipo UUID en la DB. Si rawGroupId es un entero (ej: 2), se asigna null para evitar error de sintaxis UUID.
      const validUuidGroupId = isUuid(rawGroupId) ? String(rawGroupId) : null;

      const { data: task, error: insertError } = await client
        .from('device_tasks')
        .insert({
          device_serial: device_serial || null,
          group_id: validUuidGroupId,
          type: 'SEND_SMS',
          payload: {
            notification_id: appt.id,
            number: phoneNumber,
            message: smsMessage,
            paciente: appt.nombre_paciente,
            group_id: rawGroupId,
          },
          status: 'pending',
        })
        .select()
        .single();

      if (insertError) {
        this.logger.error(`Error al insertar tarea para cita ${appt.id}: ${insertError.message}`);
      } else if (task) {
        queuedTasks.push(task);

        // Marcar la cita como 'en_cola' en notificacion_cita
        await client
          .from('notificacion_cita')
          .update({ estado_envio: 'en_cola' })
          .eq('id', appt.id);
      }
    }

    this.logger.log(`Se encolaron manualmente ${queuedTasks.length} notificaciones de citas seleccionadas.`);
    return {
      count: queuedTasks.length,
      tasks: queuedTasks,
      message: `Se encolaron ${queuedTasks.length} citas seleccionadas para envío por SMS ADB.`,
    };
  }

  /**
   * Crea una nueva tarea individual en la cola.
   */
  async createTask(dto: CreateTaskDto) {
    const client = this.supabaseService.getAdminClient();

    // Si se especifica un serial, validar su cuota
    if (dto.device_serial) {
      const { data: device } = await client
        .from('registered_devices')
        .select('*')
        .eq('device_serial', dto.device_serial)
        .maybeSingle();

      if (device && device.current_month_usage >= device.monthly_limit) {
        throw new BadRequestException(
          `El dispositivo ${device.model_name} (${dto.device_serial}) superó su límite de ${device.monthly_limit} SMS/mes. Uso actual: ${device.current_month_usage}.`,
        );
      }
    }

    const { data, error } = await client
      .from('device_tasks')
      .insert({
        device_serial: dto.device_serial || null,
        type: dto.type,
        payload: dto.payload || {},
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    this.logger.log(`Tarea ${data.id} agregada a la cola (${dto.type})`);
    return data;
  }

  /**
   * El script de Python local consulta la siguiente tarea pendiente.
   */
  async getNextPendingTask(device_serial: string, groupId?: string) {
    const client = this.supabaseService.getAdminClient();

    // Actualizar heartbeat del dispositivo (sin pasar groupId para no sobreescribir la vinculación)
    await this.registerHeartbeat({ device_serial });

    // Verificar cuota actual
    const { data: device } = await client
      .from('registered_devices')
      .select('*')
      .eq('device_serial', device_serial)
      .maybeSingle();

    if (device && device.current_month_usage >= device.monthly_limit) {
      this.logger.warn(`Dispositivo ${device_serial} con cuota agotada (${device.current_month_usage}/${device.monthly_limit}).`);
      return { task: null, message: 'Dispositivo sobre el límite mensual (1000 SMS).', quota_exceeded: true };
    }

    // Buscar tareas pendientes para este serial específico o genéricas (sin serial asignado)
    // NOTA: device_tasks.group_id es UUID (diferente a registered_devices.group_id que es bigint).
    // No se mezclan ambos campos. El filtrado es exclusivamente por device_serial.
    const { data: task, error } = await client
      .from('device_tasks')
      .select('*')
      .eq('status', 'pending')
      .or(`device_serial.eq.${device_serial},device_serial.is.null`)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!task) return { task: null };

    // Marcar como en proceso y asignar a este dispositivo
    const { data: claimedTask } = await client
      .from('device_tasks')
      .update({
        status: 'processing',
        device_serial: device_serial,
      })
      .eq('id', task.id)
      .select()
      .single();

    return { task: claimedTask, quota_exceeded: false };
  }

  /**
   * Actualiza el estado de una tarea y registra logs/resultados.
   * Si es SEND_SMS de una notificación de cita, marca `estado_envio = 'enviado'` o `'fallido'`.
   */
  async updateTaskStatus(taskId: string, dto: UpdateTaskStatusDto) {
    const client = this.supabaseService.getAdminClient();

    const { data: currentTask } = await client
      .from('device_tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (!currentTask) throw new NotFoundException(`Tarea ${taskId} no encontrada.`);

    const { data: updatedTask, error } = await client
      .from('device_tasks')
      .update({
        status: dto.status,
        result: dto.result ?? currentTask.result,
        logs: dto.logs ? `${currentTask.logs || ''}\n${dto.logs}` : currentTask.logs,
        error_message: dto.error_message ?? currentTask.error_message,
        device_serial: dto.device_serial || currentTask.device_serial,
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    const notificationId = currentTask.payload?.notification_id;
    const targetSerial = dto.device_serial || currentTask.device_serial;

    // 1. Manejo para envío de SMS
    if (currentTask.type === 'SEND_SMS') {
      if (dto.status === 'completed') {
        // Incrementar uso del dispositivo
        if (targetSerial) {
          await this.incrementDeviceUsage(targetSerial);
        }
        // Marcar la notificación de cita como 'enviado'
        if (notificationId) {
          await client
            .from('notificacion_cita')
            .update({
              estado_envio: 'enviado',
              fecha_envio: new Date().toISOString(),
            })
            .eq('id', notificationId);

          this.logger.log(`Notificación de cita ${notificationId} marcada como ENVIADA por SMS.`);
        }
      } else if (dto.status === 'failed') {
        // Marcar la notificación de cita como 'fallido'
        if (notificationId) {
          await client
            .from('notificacion_cita')
            .update({ estado_envio: 'fallido' })
            .eq('id', notificationId);

          this.logger.warn(`Notificación de cita ${notificationId} marcada como FALLIDA.`);
        }
      }
    }

    // 2. Manejo para verificación de respuestas SMS (1: Confirmado, 2: Rechazado)
    if (currentTask.type === 'CHECK_SMS_ANSWERS' && dto.status === 'completed' && dto.result?.messages) {
      await this.processIncomingSmsResponses(dto.result.messages);
    }

    return updatedTask;
  }

  /**
   * Procesa las respuestas de la bandeja SMS e impacta `estado_confirmacion` en `notificacion_cita`.
   */
  private async processIncomingSmsResponses(messages: any[]) {
    const client = this.supabaseService.getAdminClient();

    for (const msg of messages) {
      if (!msg.id || msg.type !== 1 || !msg.body || !msg.address) continue; // Solo entrantes

      const body = msg.body.trim();
      let newStatus: string | null = null;
      if (body === '1') newStatus = 'confirmado';
      else if (body === '2') newStatus = 'rechazado';

      if (!newStatus) continue;

      const cleanAddress = msg.address.replace(/^\+56/, '');

      // Buscar cita pendiente para ese teléfono
      const { data: appointment } = await client
        .from('notificacion_cita')
        .select('id')
        .or(`telefono_paciente.ilike.%${cleanAddress}%,telefono_paciente.ilike.%${msg.address}%`)
        .eq('estado_confirmacion', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (appointment) {
        await client
          .from('notificacion_cita')
          .update({
            estado_confirmacion: newStatus,
            fecha_confirmacion: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString(),
          })
          .eq('id', appointment.id);

        this.logger.log(`Cita ${appointment.id} actualizada a '${newStatus}' vía respuesta SMS.`);
      }
    }
  }

  /**
   * Incrementa el contador mensual del dispositivo.
   */
  private async incrementDeviceUsage(device_serial: string) {
    const client = this.supabaseService.getAdminClient();
    const { data: device } = await client
      .from('registered_devices')
      .select('*')
      .eq('device_serial', device_serial)
      .single();

    if (device) {
      const newUsage = device.current_month_usage + 1;
      const isOver = newUsage >= device.monthly_limit;
      await client
        .from('registered_devices')
        .update({
          current_month_usage: newUsage,
          status: isOver ? 'quota_exceeded' : 'online',
        })
        .eq('id', device.id);

      this.logger.log(`Cuota dispositivo ${device_serial}: ${newUsage}/${device.monthly_limit}`);
    }
  }

  /**
   * Obtiene el detalle de una tarea por su ID.
   */
  async getTask(taskId: string) {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('device_tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tarea ${taskId} no encontrada.`);
    return data;
  }

  /**
   * Marca un dispositivo específico como offline.
   * Llamado desde el agente local al apagarse o desconectarse el teléfono.
   */
  async markDeviceOffline(device_serial: string): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    await client
      .from('registered_devices')
      .update({ status: 'offline' })
      .eq('device_serial', device_serial);
    this.logger.log(`Dispositivo ${this.maskSerialSuffix(device_serial)} marcado como OFFLINE (shutdown del agente).`);
  }

  /**
   * Cron job: cada 30 segundos marca como OFFLINE los dispositivos que no han enviado
   * heartbeat en los últimos 45 segundos (cubre cierres abruptos / pérdida de conexión).
   */
  @Cron('*/30 * * * * *')
  async markStaleDevicesOffline(): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const cutoff = new Date(Date.now() - 45_000).toISOString(); // 45s sin heartbeat = offline

    const { data: stale } = await client
      .from('registered_devices')
      .select('id, device_serial, status')
      .eq('status', 'online')
      .lt('last_seen_at', cutoff);

    if (!stale || stale.length === 0) return;

    await client
      .from('registered_devices')
      .update({ status: 'offline' })
      .in('id', stale.map((d) => d.id));

    for (const d of stale) {
      this.logger.warn(`Timeout: Dispositivo ${this.maskSerialSuffix(d.device_serial)} marcado OFFLINE (sin heartbeat >45s).`);
    }
  }
}



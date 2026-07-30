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
  /**
   * Obtiene la lista de dispositivos.
   * - Si isAdmin=true: Devuelve todos los dispositivos con seriales completos, nombres de grupos, número no censurado y estadísticas de tareas.
   * - Si es por grupo: Vinculados al grupo devuelven serial completo, sin grupo devuelven serial censurado.
   */
  async listDevices(groupId?: string, isAdmin: boolean = false): Promise<DeviceRecord[]> {
    const client = this.supabaseService.getAdminClient();
    let query = client
      .from('registered_devices')
      .select('*')
      .order('last_seen_at', { ascending: false });

    if (groupId && !isAdmin) {
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

    // Cargar nombres de grupo si se requiere o hay grupos asociados
    const groupIds = Array.from(new Set(devices.map((d) => d.group_id).filter(Boolean)));
    let groupsMap = new Map<string, string>();
    if (groupIds.length > 0) {
      const { data: dbGroups } = await client
        .from('groups')
        .select('id, nombre, unidad')
        .in('id', groupIds);

      if (dbGroups) {
        for (const g of dbGroups) {
          groupsMap.set(String(g.id), g.nombre || g.unidad || `Grupo #${g.id}`);
        }
      }
    }

    // Cargar estadísticas de tareas si es Admin
    let taskStatsMap = new Map<string, { total: number; completed: number; failed: number; pending: number }>();
    if (isAdmin && serials.length > 0) {
      const { data: tasks } = await client
        .from('device_tasks')
        .select('device_serial, status')
        .in('device_serial', serials);

      if (tasks) {
        for (const t of tasks) {
          if (!t.device_serial) continue;
          const current = taskStatsMap.get(t.device_serial) || { total: 0, completed: 0, failed: 0, pending: 0 };
          current.total++;
          if (t.status === 'completed') current.completed++;
          else if (t.status === 'failed') current.failed++;
          else if (t.status === 'pending' || t.status === 'processing') current.pending++;
          taskStatsMap.set(t.device_serial, current);
        }
      }
    }

    return devices.map((dev) => {
      const isLinked = isAdmin ? !!dev.group_id : (!!dev.group_id && String(dev.group_id) === String(groupId));
      const maskedSerial = this.maskSerialSuffix(dev.device_serial);
      const cel = celularesMap.get(dev.device_serial);
      const groupName = dev.group_id ? groupsMap.get(String(dev.group_id)) : undefined;
      const stats = taskStatsMap.get(dev.device_serial);

      // Enmascarar últimos 4 dígitos si no es admin
      const maskedNumero = cel?.numero
        ? cel.numero.length > 4
          ? cel.numero.slice(0, -4) + '••••'
          : '••••'
        : undefined;

      return {
        ...dev,
        device_serial: (isAdmin || isLinked) ? dev.device_serial : maskedSerial,
        masked_serial: maskedSerial,
        is_linked: isLinked,
        group_name: groupName,
        task_stats: stats,
        celular_info: cel
          ? {
            marca: cel.marca,
            modelo: cel.modelo,
            nombre_completo: cel.nombre_completo,
            id_establecimiento: cel.id_establecimiento,
            estado: cel.estado,
            numero: isAdmin ? cel.numero : maskedNumero,
          }
          : undefined,
      };
    });
  }

  /**
   * Obtiene el historial de tareas procesadas por los dispositivos.
   */
  async getTaskHistory(device_serial?: string, status?: string, limit: number = 50) {
    const client = this.supabaseService.getAdminClient();
    let query = client
      .from('device_tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (device_serial) {
      query = query.eq('device_serial', device_serial);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  /**
   * Actualiza el límite de cuota mensual de SMS de un dispositivo.
   */
  async updateDeviceQuota(device_serial: string, monthly_limit: number) {
    if (monthly_limit < 1) {
      throw new BadRequestException('El límite mensual debe ser un número positivo.');
    }
    const client = this.supabaseService.getAdminClient();
    const { data: existing } = await client
      .from('registered_devices')
      .select('*')
      .eq('device_serial', device_serial)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException(`No se encontró el dispositivo con serial ${device_serial}`);
    }

    const isOverQuota = existing.current_month_usage >= monthly_limit;
    const newStatus = isOverQuota ? 'quota_exceeded' : (existing.status === 'quota_exceeded' ? 'online' : existing.status);

    const { data, error } = await client
      .from('registered_devices')
      .update({
        monthly_limit,
        status: newStatus,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Desvincula un dispositivo del grupo/establecimiento actual.
   */
  async unlinkDevice(device_serial: string) {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('registered_devices')
      .update({ group_id: null })
      .eq('device_serial', device_serial)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
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

    // Si se especifica un serial, validar su cuota y estado
    if (dto.device_serial) {
      const { data: device } = await client
        .from('registered_devices')
        .select('*')
        .eq('device_serial', dto.device_serial)
        .maybeSingle();

      if (device) {
        if (device.status === 'offline') {
          throw new BadRequestException(
            `El dispositivo ${device.model_name || dto.device_serial} se encuentra DESCONECTADO (offline). Conecte el agente local para enviar tareas.`
          );
        }
        if (device.current_month_usage >= device.monthly_limit) {
          throw new BadRequestException(
            `El dispositivo ${device.model_name} (${dto.device_serial}) superó su límite de ${device.monthly_limit} SMS/mes. Uso actual: ${device.current_month_usage}.`,
          );
        }
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
    if (!Array.isArray(messages) || messages.length === 0) return;
    const client = this.supabaseService.getAdminClient();

    this.logger.log(`Procesando ${messages.length} mensajes recuperados de la bandeja ADB...`);

    for (const msg of messages) {
      if (!msg || !msg.body || !msg.address) continue;

      // Validar tipo: solo mensajes recibidos (type === 1 o '1' o sin type especificado)
      if (msg.type !== undefined && msg.type !== null && String(msg.type) !== '1') {
        continue; // Ignorar mensajes salientes (type 2)
      }

      const rawBody = String(msg.body).trim().toLowerCase();
      let newStatus: string | null = null;

      // Regla de decisión flexible (soporta "1", "1.", "1 ok", "si", "confirmar", "confirmado")
      if (
        rawBody === '1' ||
        rawBody.startsWith('1') ||
        rawBody.includes('confirm') ||
        rawBody === 'si' ||
        rawBody === 'sí'
      ) {
        newStatus = 'confirmado';
      } else if (
        rawBody === '2' ||
        rawBody.startsWith('2') ||
        rawBody.includes('rechaz') ||
        rawBody.includes('canc') ||
        rawBody === 'no'
      ) {
        newStatus = 'rechazado';
      }

      if (!newStatus) {
        this.logger.debug(`Mensaje de ${msg.address} ("${msg.body}") no coincide con patrón de confirmación (1 o 2).`);
        continue;
      }

      // Extraer dígitos numéricos del teléfono para búsqueda infalible (evita problemas con o sin +56)
      const digitsOnly = String(msg.address).replace(/\D/g, '');
      if (digitsOnly.length < 7) {
        this.logger.warn(`Dirección SMS "${msg.address}" demasiado corta.`);
        continue;
      }

      const last8Digits = digitsOnly.slice(-8);
      const last9Digits = digitsOnly.slice(-9);

      // Buscar la cita más reciente asociada a este número telefónico
      const { data: appointment, error: searchError } = await client
        .from('notificacion_cita')
        .select('id, nombre_paciente, telefono_paciente, estado_confirmacion')
        .or(`telefono_paciente.ilike.%${last8Digits}%,telefono_paciente.ilike.%${last9Digits}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (searchError) {
        this.logger.error(`Error buscando cita para teléfono ${msg.address}: ${searchError.message}`);
        continue;
      }

      if (appointment) {
        const confirmDate = msg.date && !isNaN(Number(msg.date))
          ? new Date(Number(msg.date)).toISOString()
          : new Date().toISOString();

        const { error: updateError } = await client
          .from('notificacion_cita')
          .update({
            estado_confirmacion: newStatus,
            fecha_confirmacion: confirmDate,
          })
          .eq('id', appointment.id);

        if (updateError) {
          this.logger.error(`Error actualizando cita ${appointment.id}: ${updateError.message}`);
        } else {
          this.logger.log(
            `✅ Cita ID ${appointment.id} de "${appointment.nombre_paciente}" (${appointment.telefono_paciente}) actualizada exitosamente a '${newStatus.toUpperCase()}' vía SMS ("${msg.body}").`
          );
        }
      } else {
        this.logger.warn(`No se encontró ninguna cita registrada para el teléfono ${msg.address} (${digitsOnly}).`);
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
   * Limpia las tareas colgadas en 'processing' asociadas a un dispositivo que se desconectó
   * y revierte el estado de las citas asociadas para no corromper las estadísticas.
   */
  private async cleanupStuckTasksForOfflineDevice(device_serial: string): Promise<void> {
    const client = this.supabaseService.getAdminClient();

    const { data: stuckTasks } = await client
      .from('device_tasks')
      .select('*')
      .eq('device_serial', device_serial)
      .in('status', ['processing', 'pending']);

    if (!stuckTasks || stuckTasks.length === 0) return;

    for (const task of stuckTasks) {
      await client
        .from('device_tasks')
        .update({
          status: 'failed',
          error_message: 'Dispositivo desconectado durante la ejecución (Timeout >45s)',
        })
        .eq('id', task.id);

      const notificationId = task.payload?.notification_id;
      if (task.type === 'SEND_SMS' && notificationId) {
        await client
          .from('notificacion_cita')
          .update({ estado_envio: 'fallido' })
          .eq('id', notificationId);

        this.logger.warn(`Cita ${notificationId} marcada como FALLIDA por desconexión del equipo ${this.maskSerialSuffix(device_serial)}.`);
      }
    }
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

    await this.cleanupStuckTasksForOfflineDevice(device_serial);
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
      await this.cleanupStuckTasksForOfflineDevice(d.device_serial);
      this.logger.warn(`Timeout: Dispositivo ${this.maskSerialSuffix(d.device_serial)} marcado OFFLINE (sin heartbeat >45s). Tareas colgadas limpiadas.`);
    }
  }

  /**
   * Cron job: Cada 2 minutos consulta automáticamente respuestas SMS en los dispositivos ONLINE.
   * No encola duplicados si ya hay una tarea CHECK_SMS_ANSWERS activa para ese equipo.
   */
  @Cron('*/2 * * * *')
  async autoPollSmsAnswersCron(): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const cutoff = new Date(Date.now() - 45_000).toISOString();

    const { data: onlineDevices, error } = await client
      .from('registered_devices')
      .select('id, device_serial, group_id, status, model_name')
      .eq('status', 'online')
      .gte('last_seen_at', cutoff);

    if (error || !onlineDevices || onlineDevices.length === 0) return;

    for (const dev of onlineDevices) {
      const { data: activeTask } = await client
        .from('device_tasks')
        .select('id')
        .eq('device_serial', dev.device_serial)
        .eq('type', 'CHECK_SMS_ANSWERS')
        .in('status', ['pending', 'processing'])
        .maybeSingle();

      if (!activeTask) {
        await client
          .from('device_tasks')
          .insert({
            device_serial: dev.device_serial,
            group_id: dev.group_id ? String(dev.group_id) : null,
            type: 'CHECK_SMS_ANSWERS',
            payload: { auto_cron: true },
            status: 'pending',
          });

        this.logger.log(`Cron Automático: Lectura de respuestas SMS encolada para dispositivo ${this.maskSerialSuffix(dev.device_serial)}.`);
      }
    }
  }
}



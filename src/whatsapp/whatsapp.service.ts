import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import {
  WhatsAppWebhookPayloadDto,
  WhatsAppStatusWebhookDto,
  WhatsAppReceivedWebhookDto,
} from './dto/whatsapp-webhook.dto';
import {
  SendAppointmentsWhatsAppDto,
  SendWhatsAppMessageDto,
} from './dto/send-whatsapp-message.dto';
import { SupabaseService } from '../auth/supabase.service';

interface NotificacionCitaRow {
  id: number;
  group_id?: string | null;
  nombre_paciente?: string | null;
  telefono_paciente?: string | null;
  fecha_cita?: string | null;
  hora_cita?: string | null;
  profesional?: string | null;
  prestacion?: string | null;
  establecimiento?: string | null;
  indicaciones?: string | null;
  estado_envio?: string | null;
  fecha_envio?: string | null;
  estado_confirmacion?: string | null;
  fecha_confirmacion?: string | null;
  enviado_whatsapp?: boolean | null;
}

interface GroupQuotaRow {
  id: string;
  unidad?: string | null;
  establecimiento_id?: number | null;
  activo?: boolean | null;
  whatsapp_daily_limit?: number | null;
  whatsapp_daily_usage?: number | null;
  whatsapp_usage_date?: string | null;
}

interface ConsumeQuotaRpcResult {
  allowed?: boolean;
  not_found?: boolean;
  group_id?: string;
  group_name?: string;
  daily_limit?: number;
  daily_usage?: number;
  remaining?: number;
  usage_date?: string;
}

export interface WhatsAppGroupQuotaStatus {
  groupId: string;
  groupName: string;
  dailyLimit: number;
  dailyUsage: number;
  remaining: number;
  usageDate: string;
  exhausted: boolean;
}

type ConfirmationIntent =
  | 'confirmado'
  | 'rechazado'
  | 'solicita_reprogramacion';

const VALID_MESSAGE_TYPES = new Set(['text', 'image', 'audio', 'document']);
const VALID_STATUS_VALUES = new Set([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
]);
const CLOSED_CONFIRMATION_STATES = new Set(['no_responde', 'reasignado']);

@Injectable()
export class WhatsAppService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  // Cache en memoria para deduplicación rápida con TTL y cota máxima
  private readonly processedKeys = new Map<string, number>();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
  private readonly MAX_CACHE_SIZE = 50000;
  private readonly MAX_SYNC_BATCH = 100;
  private readonly WEBHOOK_PROCESSING_TIMEOUT_MS = 3500;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.cleanupInterval = setInterval(
      () => this.cleanOldCache(),
      60 * 60 * 1000,
    );
    this.cleanupInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Procesa el evento recibido por el Webhook de Evoluziona / WhatsApp.
   * Responde en menos de 5 segundos según Sección 2.1 del manual.
   */
  async processWebhookEvent(
    payload: WhatsAppWebhookPayloadDto,
  ): Promise<{ ok: boolean; duplicate?: boolean }> {
    const deduplicationKey = this.calculateDeduplicationKey(payload);
    if (!deduplicationKey) {
      throw new BadRequestException(
        'Evento de webhook incompleto o sin identificadores requeridos',
      );
    }

    // 1. Detección de duplicados según Sección 2.1 del manual
    if (this.isDuplicate(deduplicationKey)) {
      this.logger.log(
        `[WhatsApp Webhook] Evento duplicado ignorado: ${deduplicationKey}`,
      );
      return { ok: true, duplicate: true };
    }

    this.markAsProcessed(deduplicationKey);

    // 2. Ejecutar procesamiento en BD con timeout acotado para asegurar respuesta < 5s
    const processingPromise = this.dispatchEventAndAudit(
      payload,
      deduplicationKey,
    );

    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        processingPromise,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(() => {
            this.logger.warn(
              `[WhatsApp Webhook] Procesamiento BD excedió ${this.WEBHOOK_PROCESSING_TIMEOUT_MS}ms; devolviendo 200 OK y continuando en segundo plano.`,
            );
            resolve();
          }, this.WEBHOOK_PROCESSING_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    return { ok: true };
  }

  private async dispatchEventAndAudit(
    payload: WhatsAppWebhookPayloadDto,
    deduplicationKey: string,
  ): Promise<void> {
    let linkedNotificationId: number | null = this.extractNotificationId(
      payload.request_id,
    );

    try {
      if (payload.event === 'message.status') {
        linkedNotificationId = await this.handleMessageStatus(
          payload as WhatsAppStatusWebhookDto,
        );
      } else if (payload.event === 'message.received') {
        linkedNotificationId = await this.handleMessageReceived(
          payload as WhatsAppReceivedWebhookDto,
        );
      } else {
        this.logger.warn(
          `[WhatsApp Webhook] Evento desconocido recibido: ${payload.event}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error procesando lógica de cita para evento ${payload.event}: ${msg}`,
      );
    }

    // Auditoría asíncrona sin bloquear la respuesta
    this.saveEventToDatabase(
      payload,
      deduplicationKey,
      linkedNotificationId,
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Error guardando auditoría WhatsApp en BD: ${msg}`);
    });
  }

  private calculateDeduplicationKey(
    payload: WhatsAppWebhookPayloadDto,
  ): string | null {
    if (payload.event === 'message.status') {
      const statusDto = payload as WhatsAppStatusWebhookDto;
      if (!statusDto.status || !VALID_STATUS_VALUES.has(statusDto.status)) {
        return null;
      }
      const msgKey = statusDto.message_id || statusDto.request_id;
      if (!msgKey) return null;
      return `${statusDto.event}_${msgKey}_${statusDto.status}`;
    }

    if (payload.event === 'message.received') {
      const receivedDto = payload as WhatsAppReceivedWebhookDto;
      if (!receivedDto.message_id) return null;
      return `${receivedDto.event}_${receivedDto.message_id}`;
    }

    // Otros eventos desconocidos se auditan con clave única para no rechazar
    return `${payload.event}_${payload.message_id || payload.timestamp || randomBytes(6).toString('hex')}`;
  }

  private isDuplicate(key: string): boolean {
    const timestamp = this.processedKeys.get(key);
    if (!timestamp) return false;
    if (Date.now() - timestamp >= this.CACHE_TTL_MS) {
      this.processedKeys.delete(key);
      return false;
    }
    return true;
  }

  private markAsProcessed(key: string): void {
    if (this.processedKeys.size >= this.MAX_CACHE_SIZE) {
      for (const oldestKey of this.processedKeys.keys()) {
        this.processedKeys.delete(oldestKey);
        break;
      }
    }
    this.processedKeys.set(key, Date.now());
  }

  private cleanOldCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.processedKeys.entries()) {
      if (now - timestamp > this.CACHE_TTL_MS) {
        this.processedKeys.delete(key);
      }
    }
  }

  /**
   * Actualiza estado_envio en notificacion_cita a partir de message.status.
   * Respeta progresión sin retrocesos ante mensajes fuera de orden o reintentos previos.
   */
  private async handleMessageStatus(
    dto: WhatsAppStatusWebhookDto,
  ): Promise<number | null> {
    this.logger.log(
      `[WhatsApp Status] request_id=${dto.request_id} | message_id=${dto.message_id} | status=${dto.status} | timestamp=${dto.timestamp}`,
    );

    const notificationId = this.extractNotificationId(dto.request_id);
    if (notificationId === null) {
      this.logger.debug(
        `[WhatsApp Status] request_id "${dto.request_id}" no corresponde a un ID de notificacion_cita.`,
      );
      return null;
    }

    const client = this.supabaseService.getAdminClient();
    const { data: current, error: fetchError } = await client
      .from('notificacion_cita')
      .select(
        'id, estado_envio, fecha_envio, enviado_whatsapp, estado_confirmacion',
      )
      .eq('id', notificationId)
      .maybeSingle<NotificacionCitaRow>();

    if (fetchError) {
      this.logger.error(
        `Error buscando cita ${notificationId} para actualizar estado: ${fetchError.message}`,
      );
      return notificationId;
    }

    if (!current) {
      this.logger.warn(
        `No existe cita con ID ${notificationId} para status "${dto.status}".`,
      );
      return null;
    }

    const eventIso = this.parseIsoOrNow(dto.timestamp);
    const updateData: Record<string, unknown> = {};

    if (dto.status === 'queued') {
      if (!current.estado_envio || current.estado_envio === 'pendiente') {
        updateData.estado_envio = 'en_cola';
      }
    } else if (
      dto.status === 'sent' ||
      dto.status === 'delivered' ||
      dto.status === 'read'
    ) {
      updateData.estado_envio = 'enviado';
      updateData.enviado_whatsapp = true;
      updateData.error_mensaje = null;
      if (!current.fecha_envio) {
        updateData.fecha_envio = eventIso;
      }
    } else if (dto.status === 'failed') {
      // No degradar si el paciente ya respondió o si un intento más reciente ya fue enviado
      const alreadyConfirmedByPatient =
        Boolean(current.estado_confirmacion) &&
        current.estado_confirmacion !== 'pendiente';

      const newerSendAlreadySucceeded =
        current.estado_envio === 'enviado' &&
        Boolean(current.fecha_envio) &&
        new Date(current.fecha_envio as string).getTime() >=
          new Date(eventIso).getTime();

      if (alreadyConfirmedByPatient || newerSendAlreadySucceeded) {
        this.logger.warn(
          `[WhatsApp Status] Se ignora evento 'failed' tardío para cita ${notificationId} porque ya consta envío/confirmación más reciente.`,
        );
        return notificationId;
      }

      updateData.estado_envio = 'fallido';
      updateData.error_mensaje = `Fallo envío/entrega WhatsApp (message_id: ${dto.message_id || 'N/A'})`;
    }

    if (Object.keys(updateData).length === 0) {
      return notificationId;
    }

    const { error: updateError } = await client
      .from('notificacion_cita')
      .update(updateData)
      .eq('id', notificationId);

    if (updateError) {
      this.logger.error(
        `Error actualizando estado_envio de cita ${notificationId}: ${updateError.message}`,
      );
    } else {
      const nextEstado =
        typeof updateData.estado_envio === 'string'
          ? updateData.estado_envio
          : (current.estado_envio ?? 'sin cambio');
      this.logger.log(
        `✅ Cita ID ${notificationId} actualizada por webhook (${dto.status}) -> estado_envio='${nextEstado}'`,
      );
    }

    return notificationId;
  }

  /**
   * Procesa mensajes entrantes de pacientes (texto o audio transcrito)
   * e impacta estado_confirmacion en notificacion_cita.
   * Plan A: busca por request_id si viene informado.
   * Plan B: si request_id es null, busca por teléfono (from) la cita pendiente más reciente.
   */
  private async handleMessageReceived(
    dto: WhatsAppReceivedWebhookDto,
  ): Promise<number | null> {
    const rawText =
      dto.type === 'audio' && dto.transcript_status === 'ok'
        ? dto.transcript || ''
        : dto.text || '';

    this.logger.log(
      `[WhatsApp Received] from=${dto.from} | our_number=${dto.our_number} | type=${dto.type} | text="${rawText}" | request_id=${dto.request_id || 'null'}`,
    );

    if (dto.type === 'audio' && dto.transcript_status !== 'ok') {
      this.logger.log(
        `[WhatsApp Audio] Audio sin transcripción disponible (status=${dto.transcript_status || 'N/A'}, url=${dto.audio_url || 'N/A'}).`,
      );
    }

    const appointment = await this.findAppointmentForIncomingMessage(dto);
    if (!appointment) {
      this.logger.warn(
        `No se encontró cita activa pendiente para mensaje entrante de ${dto.from} (request_id=${dto.request_id || 'null'}).`,
      );
      return null;
    }

    const intent = this.parseConfirmationIntent(rawText);
    const client = this.supabaseService.getAdminClient();
    const eventIso = this.parseIsoOrNow(dto.timestamp);

    const updateData: Record<string, unknown> = {};

    // Si el paciente respondió, confirma implícitamente que el mensaje sí llegó,
    // aunque el webhook previo de message.status se hubiera perdido o retrasado.
    if (appointment.estado_envio !== 'enviado') {
      updateData.estado_envio = 'enviado';
      updateData.enviado_whatsapp = true;
      updateData.error_mensaje = null;
      if (!appointment.fecha_envio) {
        updateData.fecha_envio = eventIso;
      }
    }

    const isClosedAppointment =
      Boolean(appointment.estado_confirmacion) &&
      CLOSED_CONFIRMATION_STATES.has(appointment.estado_confirmacion as string);

    if (intent && isClosedAppointment) {
      this.logger.warn(
        `[WhatsApp Received] La cita ID ${appointment.id} está cerrada/expirada ('${appointment.estado_confirmacion}'); no se sobrescribe estado_confirmacion.`,
      );
    } else if (intent) {
      updateData.estado_confirmacion = intent;
      updateData.fecha_confirmacion = eventIso;
    } else {
      this.logger.debug(
        `Mensaje de ${dto.from} ("${rawText}") vinculado a cita ${appointment.id}, pero sin intención clara de confirmación/rechazo.`,
      );
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await client
        .from('notificacion_cita')
        .update(updateData)
        .eq('id', appointment.id);

      if (updateError) {
        this.logger.error(
          `Error actualizando cita ${appointment.id} desde mensaje entrante: ${updateError.message}`,
        );
      } else if (intent) {
        this.logger.log(
          `✅ Cita ID ${appointment.id} de "${appointment.nombre_paciente || 'Paciente'}" (${appointment.telefono_paciente || dto.from}) actualizada a '${intent.toUpperCase()}' vía WhatsApp ("${rawText}").`,
        );
      } else {
        this.logger.log(
          `✅ Cita ID ${appointment.id} marcada como 'enviado' al recibir respuesta del paciente ("${rawText}").`,
        );
      }
    }

    return appointment.id;
  }

  /**
   * Busca la cita correspondiente a un mensaje entrante:
   * 1. Por request_id si Evoluziona lo asoció verificablemente.
   * 2. Fallback por teléfono (from), tolerando espacios/guiones en telefono_paciente.
   */
  private async findAppointmentForIncomingMessage(
    dto: WhatsAppReceivedWebhookDto,
  ): Promise<NotificacionCitaRow | null> {
    const client = this.supabaseService.getAdminClient();
    const selectFields =
      'id, nombre_paciente, telefono_paciente, estado_confirmacion, estado_envio, fecha_envio, fecha_cita, hora_cita';

    // Plan A: request_id explícito (ej. cuando el paciente responde citando el mensaje)
    const explicitId = this.extractNotificationId(dto.request_id);
    if (explicitId !== null) {
      const { data: byId, error } = await client
        .from('notificacion_cita')
        .select(selectFields)
        .eq('id', explicitId)
        .eq('activo', true)
        .maybeSingle<NotificacionCitaRow>();

      if (!error && byId) {
        return byId;
      }
    }

    // Plan B: fallback por últimos 8 dígitos normalizados del remitente (from)
    const digitsOnly = String(dto.from || '').replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      this.logger.warn(`Número remitente "${dto.from}" demasiado corto.`);
      return null;
    }

    const last8 = digitsOnly.slice(-8);
    const last4 = digitsOnly.slice(-4);

    // Ventana temporal en zona horaria de Chile: hoy hasta +7 días
    const today = this.getChileTodayDate();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const maxDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(futureDate);

    // Criterios de seguridad para evitar falsos positivos:
    // 1. Debe haber sido efectivamente enviada por WhatsApp (enviado_whatsapp = true).
    // 2. Estado de confirmación debe estar pendiente.
    // 3. fecha_cita debe estar dentro de la ventana de hoy a +7 días.
    // 4. Ordenamos por fecha_cita asc y hora_cita asc para priorizar la cita más urgente/próxima.
    const { data: candidates, error: pendingError } = await client
      .from('notificacion_cita')
      .select(selectFields)
      .eq('activo', true)
      .eq('estado_confirmacion', 'pendiente')
      .eq('enviado_whatsapp', true)
      .gte('fecha_cita', today)
      .lte('fecha_cita', maxDate)
      .ilike('telefono_paciente', `%${last4}%`)
      .order('fecha_cita', { ascending: true })
      .order('hora_cita', { ascending: true })
      .limit(25)
      .returns<NotificacionCitaRow[]>();

    if (pendingError) {
      this.logger.error(
        `Error buscando cita pendiente para ${dto.from}: ${pendingError.message}`,
      );
      return null;
    }

    if (!candidates || candidates.length === 0) {
      return null;
    }

    // Validación estricta en memoria sobre los últimos 8 dígitos limpios
    const matchingCandidates = candidates.filter((row) => {
      const rowDigits = String(row.telefono_paciente || '').replace(/\D/g, '');
      return rowDigits.length >= 8 && rowDigits.slice(-8) === last8;
    });

    if (matchingCandidates.length === 0) {
      return null;
    }

    if (matchingCandidates.length > 1) {
      this.logger.log(
        `[WhatsApp Received] Múltiples citas pendientes (${matchingCandidates.length}) encontradas para ${dto.from}. Se prioriza la más próxima: ID ${matchingCandidates[0].id} (${matchingCandidates[0].fecha_cita} ${matchingCandidates[0].hora_cita || ''}).`,
      );
    }

    return matchingCandidates[0];
  }

  /**
   * Interpreta la respuesta del paciente (1/confirmar, 2/rechazar, 3/reprogramar).
   * Evalúa reprogramación y rechazo antes que confirmación para evitar falsos positivos.
   */
  private parseConfirmationIntent(rawText: string): ConfirmationIntent | null {
    // Normalizar texto: minúsculas, sin acentos para comparación tolerante
    const clean = rawText.trim().toLowerCase();
    if (!clean) return null;

    // Normalizado sin tildes
    const normalized = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. Reprogramación / Cambio de hora (antes que rechazo para capturar "no puedo ese día, quiero cambiar la hora")
    if (
      /^3(?:\s|$|[.!?,)])/.test(clean) ||
      normalized.includes('reprogram') ||
      normalized.includes('reagend') ||
      normalized.includes('cambiar hora') ||
      normalized.includes('cambio de hora') ||
      normalized.includes('cambiar el dia') ||
      normalized.includes('otra hora') ||
      normalized.includes('otro dia') ||
      normalized.includes('otra fecha') ||
      /cambiar\s+(?:la\s+)?hora/.test(normalized)
    ) {
      return 'solicita_reprogramacion';
    }

    // 2. Rechazo / Cancelación (antes que confirmación para capturar "no confirmo", "no podre ir", etc.)
    if (
      /^2(?:\s|$|[.!?,)])/.test(clean) ||
      /^(?:no|no puedo|no voy|imposible|rechazo|rechazado|cancelo|cancelar|anular|no asisto|no asisto|no voy a poder|no alcanzo|no llego)(?:\s|$|[.!?,)])/.test(
        normalized,
      ) ||
      /\bno\s+(?:confirm\w*|asistir\w*|voy|puedo|podr[eé]|podre|ire|ir[eé]|alcanzo|llego)\b/.test(
        normalized,
      ) ||
      normalized.includes('rechaz') ||
      normalized.includes('cancel') ||
      normalized.includes('anul') ||
      normalized.includes('no puedo') ||
      normalized.includes('no podre') ||
      normalized.includes('no podre') ||
      normalized.includes('no voy a poder') ||
      normalized.includes('no voy a asistir') ||
      normalized.includes('no voy a ir') ||
      normalized.includes('no alcanzo') ||
      normalized.includes('con licencia') ||
      normalized.includes('estoy con licencia') ||
      normalized.includes('estoy enfermo') ||
      normalized.includes('estoy enferma') ||
      normalized.includes('estoy hospitalizad') ||
      normalized.includes('me encuentro enfermo') ||
      rawText.includes('👎') ||
      rawText.includes('❌')
    ) {
      return 'rechazado';
    }

    // 3. Confirmación (incluye chilenismos, variantes ortográficas y afirmaciones coloquiales)
    // Lookahead negativo: "1 <texto>" solo confirma si el resto no empieza con negación o cancelación.
    if (
      /^1(?:$|[.!?,)]|(?:ok|si|sí)(?:\s|$|[.!?,)])|(\s+)(?!no\b|cancel|rechaz|anula|imposib))/.test(
        clean,
      ) ||
      /^(?:si|sí|ok|dale|voy|confirmo|confirmado|confirma|asisto|presente|asistire|ire|asiste|comfirmo|confrimo|cinfirmo)(?:\s|$|[.!?,)])/.test(
        normalized,
      ) ||
      normalized.includes('confirm') ||
      normalized.includes('comfirm') || // Error tipográfico común
      normalized.includes('confrim') || // Error tipográfico común
      normalized.includes('asistir') ||
      normalized.includes('asistire') ||
      normalized.includes('asisto') ||
      normalized.includes('ahi estare') ||
      normalized.includes('ahi voy a estar') ||
      normalized.includes('alla estare') ||
      normalized.includes('voy a ir') ||
      normalized.includes('voy a asistir') ||
      normalized.includes('cuente conmigo') ||
      normalized.includes('de alla somos') ||
      normalized.includes('ya po') ||
      rawText.includes('👍') ||
      rawText.includes('✅')
    ) {
      return 'confirmado';
    }

    return null;
  }

  /**
   * Guarda el evento de auditoría en Supabase si la tabla whatsapp_webhook_events existe.
   */
  private async saveEventToDatabase(
    payload: WhatsAppWebhookPayloadDto,
    dedupKey: string,
    notificationId: number | null,
  ): Promise<void> {
    try {
      const adminClient = this.supabaseService.getAdminClient();
      const statusPayload = payload as WhatsAppStatusWebhookDto;
      const receivedPayload = payload as WhatsAppReceivedWebhookDto;

      await adminClient.from('whatsapp_webhook_events').upsert(
        [
          {
            dedup_key: dedupKey,
            event: payload.event,
            notification_id: notificationId,
            request_id: payload.request_id || null,
            message_id: payload.message_id || null,
            status: statusPayload.status || null,
            from_number: receivedPayload.from || null,
            our_number: receivedPayload.our_number || null,
            message_type: receivedPayload.type || null,
            text_content:
              receivedPayload.text || receivedPayload.transcript || null,
            payload: payload,
            event_timestamp: this.parseIsoOrNow(payload.timestamp),
            created_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'dedup_key', ignoreDuplicates: true },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `No se pudo registrar en tabla whatsapp_webhook_events: ${msg}`,
      );
    }
  }

  /**
   * Verifica la disponibilidad operativa del módulo WhatsApp del Gateway.
   */
  getHealthStatus(): { status: string; service: string; timestamp: string } {
    const token =
      this.configService.get<string>('WHATSAPP_EVOLUZIONA_SEND_TOKEN') ||
      process.env.WHATSAPP_EVOLUZIONA_SEND_TOKEN;

    if (!token) {
      throw new ServiceUnavailableException(
        'El servicio de envío de WhatsApp no está configurado en el servidor.',
      );
    }

    return {
      status: 'ok',
      service: 'whatsapp-webhook-receiver',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Consulta la cuota diaria de WhatsApp API para un grupo (resetea visualmente si cambió el día).
   */
  async getGroupQuota(
    groupId?: string,
    userId?: string,
  ): Promise<WhatsAppGroupQuotaStatus> {
    const resolvedGroupId = await this.resolveEffectiveGroupId(
      undefined,
      groupId,
      userId,
    );
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('groups')
      .select(
        'id, unidad, whatsapp_daily_limit, whatsapp_daily_usage, whatsapp_usage_date',
      )
      .eq('id', resolvedGroupId)
      .maybeSingle<GroupQuotaRow>();

    if (error) {
      throw new BadRequestException(
        `Error consultando cuota del grupo: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        `No se encontró el grupo con ID ${resolvedGroupId}.`,
      );
    }

    return this.buildQuotaStatus(data);
  }

  /**
   * Lista las cuotas diarias de WhatsApp API de todos los grupos activos.
   */
  async listGroupQuotas(): Promise<WhatsAppGroupQuotaStatus[]> {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('groups')
      .select(
        'id, unidad, activo, whatsapp_daily_limit, whatsapp_daily_usage, whatsapp_usage_date',
      )
      .eq('activo', true)
      .order('unidad');

    if (error) {
      throw new BadRequestException(
        `Error listando cuotas de grupos: ${error.message}`,
      );
    }

    return ((data || []) as GroupQuotaRow[]).map((row) =>
      this.buildQuotaStatus(row),
    );
  }

  /**
   * Actualiza el límite diario de mensajes WhatsApp API para un grupo.
   */
  async updateGroupQuota(
    groupId: string,
    dailyLimit: number,
    userId?: string,
  ): Promise<WhatsAppGroupQuotaStatus> {
    if (!groupId || !groupId.trim()) {
      throw new BadRequestException('El ID del grupo es obligatorio.');
    }

    const parsedLimit = Number(dailyLimit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 0 ||
      parsedLimit > 100000
    ) {
      throw new BadRequestException(
        'El límite diario debe ser un número entero entre 0 y 100000.',
      );
    }

    if (userId) {
      await this.assertCanManageGroupQuota(userId);
    }

    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('groups')
      .update({ whatsapp_daily_limit: parsedLimit })
      .eq('id', groupId.trim())
      .select(
        'id, unidad, whatsapp_daily_limit, whatsapp_daily_usage, whatsapp_usage_date',
      )
      .maybeSingle<GroupQuotaRow>();

    if (error) {
      throw new BadRequestException(
        `Error actualizando cuota del grupo: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(`No se encontró el grupo ${groupId}.`);
    }

    return this.buildQuotaStatus(data);
  }

  /**
   * Envía un mensaje individual a través de Evoluziona.
   * Si se proporciona notificationId, obtiene teléfono/mensaje por defecto y actualiza notificacion_cita a 'en_cola'.
   */
  async sendMessage(
    dto: SendWhatsAppMessageDto,
    userId?: string,
  ): Promise<Record<string, unknown>> {
    const sendUrl =
      this.configService.get<string>('WHATSAPP_EVOLUZIONA_SEND_URL') ||
      'https://omnisuite-hospitalcurico.evoluziona.cl/webhooks/whatsapp/send';

    const token =
      this.configService.get<string>('WHATSAPP_EVOLUZIONA_SEND_TOKEN') ||
      process.env.WHATSAPP_EVOLUZIONA_SEND_TOKEN;

    if (!token) {
      throw new InternalServerErrorException(
        'Configuración de envío de WhatsApp incompleta en el servidor.',
      );
    }

    const msgType = dto.type || 'text';
    if (!VALID_MESSAGE_TYPES.has(msgType)) {
      throw new BadRequestException(
        `Tipo de mensaje inválido "${msgType}". Permitidos: text, image, audio, document.`,
      );
    }

    if (msgType !== 'text') {
      if (!dto.media_url || !/^https:\/\/.+/i.test(dto.media_url.trim())) {
        throw new BadRequestException(
          'media_url debe ser una dirección HTTPS válida para envíos multimedia.',
        );
      }
      if (msgType === 'document' && !dto.filename?.trim()) {
        throw new BadRequestException(
          'filename es obligatorio cuando type es document.',
        );
      }
    }

    const client = this.supabaseService.getAdminClient();
    let appointment: NotificacionCitaRow | null = null;

    if (dto.notificationId !== undefined && dto.notificationId !== null) {
      const { data, error } = await client
        .from('notificacion_cita')
        .select(
          'id, group_id, nombre_paciente, telefono_paciente, fecha_cita, hora_cita, profesional, prestacion, establecimiento, indicaciones, estado_envio, estado_confirmacion',
        )
        .eq('id', dto.notificationId)
        .eq('activo', true)
        .maybeSingle<NotificacionCitaRow>();

      if (error) {
        throw new BadRequestException(
          `Error consultando cita ${dto.notificationId}: ${error.message}`,
        );
      }
      if (!data) {
        throw new NotFoundException(
          `No se encontró cita activa con ID ${dto.notificationId}`,
        );
      }
      if (
        data.estado_confirmacion &&
        CLOSED_CONFIRMATION_STATES.has(data.estado_confirmacion)
      ) {
        throw new BadRequestException(
          `No se puede enviar WhatsApp a la cita ${dto.notificationId} porque está en estado '${data.estado_confirmacion}'.`,
        );
      }
      appointment = data;
    }

    const rawPhone = dto.to || appointment?.telefono_paciente || '';
    const normalizedPhone = this.normalizeChileanPhone(rawPhone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      throw new BadRequestException(
        'Número de teléfono inválido o ausente para envío por WhatsApp.',
      );
    }

    const textToSend =
      dto.text ||
      (appointment ? this.buildDefaultReminderText(appointment) : '');

    if (msgType === 'text' && !textToSend.trim()) {
      throw new BadRequestException(
        'El contenido del mensaje (text) es obligatorio.',
      );
    }

    const effectiveGroupId = await this.resolveEffectiveGroupId(
      appointment?.group_id,
      dto.groupId,
      userId,
    );
    const consumedQuota = await this.consumeGroupDailyQuota(
      effectiveGroupId,
      1,
    );

    const requestId =
      dto.request_id || this.buildRequestId(dto.notificationId ?? null);

    const body: Record<string, string> = {
      event: 'message.send',
      request_id: requestId,
      to: normalizedPhone,
      type: msgType,
      timestamp: this.formatIsoWithOffset(),
    };

    if (msgType === 'text' || (msgType !== 'audio' && textToSend.trim())) {
      body.text = textToSend;
    }
    if (dto.media_url) body.media_url = dto.media_url.trim();
    if (dto.filename) body.filename = dto.filename.trim();

    this.logger.log(
      `Enviando WhatsApp a ${normalizedPhone} [request_id=${requestId}, group_id=${effectiveGroupId}, cuota=${consumedQuota.dailyUsage}/${consumedQuota.dailyLimit}]`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<Record<string, unknown>>(sendUrl, body, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      if (appointment) {
        await this.markAppointmentQueued(appointment);
      }

      return {
        ...response.data,
        notificationId: appointment?.id ?? null,
        quota: consumedQuota,
      };
    } catch (err: unknown) {
      await this.refundGroupDailyQuota(effectiveGroupId, 1);

      const axiosErr = err as AxiosError<Record<string, unknown>>;
      const status = axiosErr.response?.status;
      const errDetail =
        (axiosErr.response?.data?.error as string) ||
        (axiosErr.response?.data?.message as string) ||
        axiosErr.message ||
        'Error desconocido al enviar WhatsApp';

      if (appointment) {
        const isPermanentError =
          status === 400 || status === 401 || status === 409;
        await client
          .from('notificacion_cita')
          .update({
            ...(isPermanentError ? { estado_envio: 'fallido' } : {}),
            error_mensaje: `Error WhatsApp (${status ?? 'red'}): ${errDetail}`,
          })
          .eq('id', appointment.id);
      }

      if (status && status >= 400 && status < 500) {
        throw new HttpException(
          { ok: false, status, error: errDetail, request_id: requestId },
          status,
        );
      }
      throw new BadGatewayException(
        `No se pudo encolar el mensaje en Evoluziona: ${errDetail}`,
      );
    }
  }

  /**
   * Envía notificaciones por WhatsApp para una lista acotada de IDs de notificacion_cita.
   */
  async sendAppointments(
    dto: SendAppointmentsWhatsAppDto,
    userId?: string,
  ): Promise<{
    total: number;
    queued: number;
    failed: number;
    results: Array<{
      notificationId: number;
      ok: boolean;
      request_id?: string;
      error?: string;
    }>;
  }> {
    if (!dto.notificationIds || dto.notificationIds.length === 0) {
      throw new BadRequestException(
        'Debe proporcionar al menos un notificationId.',
      );
    }

    const uniqueIds = Array.from(new Set(dto.notificationIds));
    if (uniqueIds.length > this.MAX_SYNC_BATCH) {
      throw new BadRequestException(
        `El lote síncrono admite máximo ${this.MAX_SYNC_BATCH} citas por solicitud (recibidas: ${uniqueIds.length}).`,
      );
    }

    const results: Array<{
      notificationId: number;
      ok: boolean;
      request_id?: string;
      error?: string;
    }> = [];

    let queued = 0;
    let failed = 0;

    for (const id of uniqueIds) {
      const customText = dto.messages?.[String(id)];
      try {
        const res = await this.sendMessage(
          {
            notificationId: id,
            text: customText,
          },
          userId,
        );
        queued++;
        results.push({
          notificationId: id,
          ok: true,
          request_id: typeof res.request_id === 'string' ? res.request_id : '',
        });
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          notificationId: id,
          ok: false,
          error: msg,
        });
      }
    }

    return {
      total: uniqueIds.length,
      queued,
      failed,
      results,
    };
  }

  private async resolveEffectiveGroupId(
    appointmentGroupId?: string | null,
    dtoGroupId?: string,
    userId?: string,
  ): Promise<string> {
    if (appointmentGroupId && String(appointmentGroupId).trim()) {
      return String(appointmentGroupId).trim();
    }
    if (dtoGroupId && dtoGroupId.trim()) {
      return dtoGroupId.trim();
    }

    if (userId) {
      const client = this.supabaseService.getAdminClient();
      const { data } = await client
        .from('groups_members')
        .select('group_id, predeterminado')
        .eq('usuario_id', userId)
        .order('predeterminado', { ascending: false })
        .limit(1)
        .maybeSingle<{ group_id: string; predeterminado?: boolean }>();

      if (data?.group_id) {
        return String(data.group_id);
      }
    }

    throw new BadRequestException(
      'No se pudo determinar el grupo del envío para validar su cuota diaria de WhatsApp.',
    );
  }

  private async assertCanManageGroupQuota(userId: string): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('user_role')
      .select('role:role_id(nombre)')
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(
        `No se pudieron validar los permisos del usuario: ${error.message}`,
      );
    }

    const allowedRoles = new Set([
      'Administrador del Sistema',
      'Editar Grupos',
      'Crear Grupos',
    ]);
    const hasPermission = (data || []).some(
      (entry: Record<string, unknown>) => {
        const roleObj = entry.role as { nombre?: string } | null | undefined;
        return roleObj?.nombre ? allowedRoles.has(roleObj.nombre) : false;
      },
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'No tienes permisos para modificar el límite diario de WhatsApp de los grupos.',
      );
    }
  }

  private buildQuotaStatus(row: GroupQuotaRow): WhatsAppGroupQuotaStatus {
    const today = this.getChileTodayDate();
    const dailyLimit = Math.max(0, Number(row.whatsapp_daily_limit ?? 50));
    const isSameDay = row.whatsapp_usage_date === today;
    const dailyUsage = isSameDay
      ? Math.max(0, Number(row.whatsapp_daily_usage ?? 0))
      : 0;
    const remaining = Math.max(0, dailyLimit - dailyUsage);

    return {
      groupId: String(row.id),
      groupName: row.unidad || 'Grupo',
      dailyLimit,
      dailyUsage,
      remaining,
      usageDate: today,
      exhausted: dailyLimit <= 0 || dailyUsage >= dailyLimit,
    };
  }

  private async consumeGroupDailyQuota(
    groupId: string,
    count = 1,
  ): Promise<WhatsAppGroupQuotaStatus> {
    const client = this.supabaseService.getAdminClient();

    // Ruta atómica mediante RPC de PostgreSQL (bloquea fila con FOR UPDATE).
    const rpcResponse = (await client.rpc('consume_whatsapp_group_quota', {
      p_group_id: groupId,
      p_count: count,
    })) as {
      data: ConsumeQuotaRpcResult | null;
      error: { code?: string; message?: string } | null;
    };
    const rpcData = rpcResponse.data;
    const rpcError = rpcResponse.error;

    if (!rpcError && rpcData) {
      const res = rpcData;
      if (res.not_found) {
        throw new NotFoundException(`No se encontró el grupo ${groupId}.`);
      }

      const status: WhatsAppGroupQuotaStatus = {
        groupId: String(res.group_id || groupId),
        groupName: res.group_name || 'Grupo',
        dailyLimit: Math.max(0, Number(res.daily_limit ?? 0)),
        dailyUsage: Math.max(0, Number(res.daily_usage ?? 0)),
        remaining: Math.max(0, Number(res.remaining ?? 0)),
        usageDate: res.usage_date || this.getChileTodayDate(),
        exhausted:
          !res.allowed ||
          Number(res.daily_limit ?? 0) <= 0 ||
          Number(res.daily_usage ?? 0) >= Number(res.daily_limit ?? 0),
      };

      if (!res.allowed) {
        throw new HttpException(
          {
            ok: false,
            code: 'WHATSAPP_DAILY_QUOTA_EXCEEDED',
            message:
              status.dailyLimit <= 0
                ? `El grupo "${status.groupName}" no tiene envíos por WhatsApp API habilitados (límite: 0/día).`
                : `Límite diario de WhatsApp API alcanzado para "${status.groupName}" (${status.dailyUsage}/${status.dailyLimit} mensajes hoy).`,
            quota: status,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return status;
    }

    // Fallback cuando la función RPC aún no existe en el schema cache, operando directo sobre `groups`.
    const isMissingRpc =
      rpcError &&
      (rpcError.code === 'PGRST202' ||
        rpcError.message?.includes('consume_whatsapp_group_quota'));

    if (rpcError && !isMissingRpc) {
      throw new BadRequestException(
        `Error validando cuota diaria de WhatsApp: ${rpcError.message}`,
      );
    }

    const { data: row, error: fetchError } = await client
      .from('groups')
      .select(
        'id, unidad, whatsapp_daily_limit, whatsapp_daily_usage, whatsapp_usage_date',
      )
      .eq('id', groupId)
      .maybeSingle<GroupQuotaRow>();

    if (fetchError) {
      throw new BadRequestException(
        `Error consultando cuota diaria del grupo: ${fetchError.message}`,
      );
    }
    if (!row) {
      throw new NotFoundException(`No se encontró el grupo ${groupId}.`);
    }

    const current = this.buildQuotaStatus(row);
    if (
      current.dailyLimit <= 0 ||
      current.dailyUsage + count > current.dailyLimit
    ) {
      if (row.whatsapp_usage_date !== current.usageDate) {
        await client
          .from('groups')
          .update({
            whatsapp_daily_usage: 0,
            whatsapp_usage_date: current.usageDate,
          })
          .eq('id', groupId);
      }

      throw new HttpException(
        {
          ok: false,
          code: 'WHATSAPP_DAILY_QUOTA_EXCEEDED',
          message:
            current.dailyLimit <= 0
              ? `El grupo "${current.groupName}" no tiene envíos por WhatsApp API habilitados (límite: 0/día).`
              : `Límite diario de WhatsApp API alcanzado para "${current.groupName}" (${current.dailyUsage}/${current.dailyLimit} mensajes hoy).`,
          quota: current,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const newUsage = current.dailyUsage + count;
    const { error: updateError } = await client
      .from('groups')
      .update({
        whatsapp_daily_usage: newUsage,
        whatsapp_usage_date: current.usageDate,
      })
      .eq('id', groupId);

    if (updateError) {
      throw new BadRequestException(
        `Error descontando cuota diaria del grupo: ${updateError.message}`,
      );
    }

    return {
      ...current,
      dailyUsage: newUsage,
      remaining: Math.max(0, current.dailyLimit - newUsage),
      exhausted: newUsage >= current.dailyLimit,
    };
  }

  private async refundGroupDailyQuota(
    groupId: string,
    count = 1,
  ): Promise<void> {
    try {
      const client = this.supabaseService.getAdminClient();
      const { error: rpcError } = await client.rpc(
        'refund_whatsapp_group_quota',
        { p_group_id: groupId, p_count: count },
      );

      if (!rpcError) return;

      const today = this.getChileTodayDate();
      const { data: row } = await client
        .from('groups')
        .select('whatsapp_daily_usage, whatsapp_usage_date')
        .eq('id', groupId)
        .maybeSingle<GroupQuotaRow>();

      if (row && row.whatsapp_usage_date === today) {
        const nextUsage = Math.max(
          0,
          Number(row.whatsapp_daily_usage ?? 0) - count,
        );
        await client
          .from('groups')
          .update({ whatsapp_daily_usage: nextUsage })
          .eq('id', groupId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `No se pudo reembolsar cuota diaria de WhatsApp para grupo ${groupId}: ${msg}`,
      );
    }
  }

  private getChileTodayDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private async markAppointmentQueued(
    appointment: NotificacionCitaRow,
  ): Promise<void> {
    if (appointment.estado_envio === 'enviado') return;

    const client = this.supabaseService.getAdminClient();
    const { error } = await client
      .from('notificacion_cita')
      .update({
        estado_envio: 'en_cola',
        error_mensaje: null,
      })
      .eq('id', appointment.id);

    if (error) {
      this.logger.warn(
        `No se pudo actualizar cita ${appointment.id} a 'en_cola': ${error.message}`,
      );
    }
  }

  private buildRequestId(notificationId: number | null): string {
    const suffix = randomBytes(3).toString('hex');
    if (notificationId !== null) {
      return `cita-${notificationId}-${suffix}`;
    }
    return `curico-${Date.now()}-${suffix}`;
  }

  private extractNotificationId(requestId?: string | null): number | null {
    if (!requestId) return null;
    const trimmed = requestId.trim();

    // Formato compuesto: cita-<id>-<hash>
    const compositeMatch = /^cita-(\d+)(?:-|$)/.exec(trimmed);
    if (compositeMatch) {
      return Number(compositeMatch[1]);
    }

    // Formato numérico directo (si se envió solo la PK)
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    return null;
  }

  private normalizeChileanPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 12 && digits.startsWith('5609')) {
      return `56${digits.substring(3)}`;
    }
    if (digits.length === 10 && digits.startsWith('09')) {
      return `56${digits.substring(1)}`;
    }
    if (digits.length === 9 && digits.startsWith('9')) {
      return `56${digits}`;
    }
    if (digits.length === 8) {
      return `569${digits}`;
    }
    return digits;
  }

  private buildDefaultReminderText(appt: NotificacionCitaRow): string {
    const paciente = appt.nombre_paciente || 'Paciente';
    const fecha = appt.fecha_cita || 'fecha programada';
    const hora = appt.hora_cita ? ` a las ${appt.hora_cita}` : '';
    const lugar = appt.establecimiento || 'su centro de salud';
    const profesional = appt.profesional ? ` con ${appt.profesional}` : '';
    const prestacion = appt.prestacion ? ` (${appt.prestacion})` : '';

    return (
      `Hola ${paciente}, le recordamos su cita médica${prestacion}${profesional} ` +
      `para el ${fecha}${hora} en ${lugar}.\n\n` +
      `Por favor responda:\n` +
      `1 para CONFIRMAR su asistencia\n` +
      `2 para RECHAZAR / CANCELAR\n` +
      `3 para solicitar REPROGRAMACIÓN`
    );
  }

  private parseIsoOrNow(value?: string): string {
    if (value) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return new Date().toISOString();
  }

  private formatIsoWithOffset(date = new Date()): string {
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    const local = new Date(date.getTime() + offsetMin * 60000)
      .toISOString()
      .replace('Z', '');
    return `${local.slice(0, 19)}${sign}${hh}:${mm}`;
  }
}

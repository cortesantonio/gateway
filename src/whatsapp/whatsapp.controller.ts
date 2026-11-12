import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WhatsAppService, WhatsAppGroupQuotaStatus } from './whatsapp.service';
import { WhatsAppWebhookGuard } from './guards/whatsapp-webhook.guard';
import { WhatsAppWebhookPayloadDto } from './dto/whatsapp-webhook.dto';
import {
  SendAppointmentsWhatsAppDto,
  SendWhatsAppMessageDto,
  UpdateWhatsAppQuotaDto,
} from './dto/send-whatsapp-message.dto';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

interface AuthenticatedRequest {
  user?: {
    id?: string;
  };
}

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * Health check para validar que el servicio del webhook está operativo
   */
  @Get('health')
  healthCheck() {
    return this.whatsappService.getHealthStatus();
  }

  /**
   * Consulta la cuota diaria disponible de WhatsApp API para un grupo (o grupo predeterminado del usuario).
   */
  @Get('quota')
  @SkipThrottle()
  @UseGuards(SupabaseAuthGuard)
  async getGroupQuota(
    @Query('groupId') groupId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<WhatsAppGroupQuotaStatus> {
    return await this.whatsappService.getGroupQuota(groupId, req.user?.id);
  }

  /**
   * Lista el consumo y límite diario de WhatsApp API de los grupos activos.
   */
  @Get('quotas')
  @SkipThrottle()
  @UseGuards(SupabaseAuthGuard)
  async listGroupQuotas(): Promise<WhatsAppGroupQuotaStatus[]> {
    return await this.whatsappService.listGroupQuotas();
  }

  /**
   * Actualiza el límite diario de mensajes WhatsApp API para un grupo.
   */
  @Patch('quota/:groupId')
  @SkipThrottle()
  @UseGuards(SupabaseAuthGuard)
  async updateGroupQuota(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateWhatsAppQuotaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WhatsAppGroupQuotaStatus> {
    return await this.whatsappService.updateGroupQuota(
      groupId,
      dto?.daily_limit,
      req.user?.id,
    );
  }

  /**
   * Webhook receptor según Sección 2 del manual de Evoluziona.
   * Exento de rate-limiting por IP para no bloquear ráfagas legítimas del proveedor.
   * Debe responder 200 {"ok": true} en menos de 5 segundos.
   */
  @Post('webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WhatsAppWebhookGuard)
  async handleWebhook(@Body() payload: WhatsAppWebhookPayloadDto) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof payload.event !== 'string' ||
      !payload.event.trim()
    ) {
      throw new BadRequestException('Payload de webhook inválido');
    }

    this.logger.log(`[WhatsApp Webhook] Evento recibido: ${payload.event}`);

    const result = await this.whatsappService.processWebhookEvent(payload);
    return { ok: true, ...(result.duplicate ? { duplicate: true } : {}) };
  }

  /**
   * Endpoint interno autenticado para disparar un envío individual por WhatsApp
   * (puede recibir notificationId para vincularlo directo a notificacion_cita).
   * Exento de rate-limit por ráfagas 1x1 desde el ERP (protegido por SupabaseAuthGuard).
   */
  @Post('send')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async sendMessage(
    @Body() dto: SendWhatsAppMessageDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return await this.whatsappService.sendMessage(dto, req.user?.id);
  }

  /**
   * Endpoint autenticado para enviar en lote notificaciones de citas seleccionadas.
   */
  @Post('send-appointments')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async sendAppointments(
    @Body() dto: SendAppointmentsWhatsAppDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.whatsappService.sendAppointments(dto, req.user?.id);
  }
}

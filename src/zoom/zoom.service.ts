import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../auth/supabase.service';
import { CreateZoomMeetingDto, ZoomMeetingResponse } from './dto/create-zoom-meeting.dto';

interface CachedZoomToken {
  token: string;
  expiresAt: number; // unix timestamp ms
}

@Injectable()
export class ZoomService {
  private readonly logger = new Logger(ZoomService.name);
  private cachedToken: CachedZoomToken | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Valida si el usuario solicitante tiene rol de Administrador o Gestor de Solicitudes Zoom
   */
  async validateUserRole(userId: string): Promise<boolean> {
    try {
      const client = this.supabaseService.getClient();
      const { data, error } = await client
        .from('user_role')
        .select('role:role_id(nombre)')
        .eq('user_id', userId);

      if (error || !data) {
        this.logger.warn(`Error al verificar roles para usuario ${userId}: ${error?.message}`);
        return false;
      }

      const allowedRoles = new Set([
        'Administrador del Sistema',
        'Gestionar Solicitudes Zoom',
      ]);

      return data.some((entry: any) => {
        const roleObj = entry.role as { nombre?: string } | null | undefined;
        return roleObj?.nombre ? allowedRoles.has(roleObj.nombre) : false;
      });
    } catch (err: any) {
      this.logger.error(`Excepción al validar permisos de usuario: ${err.message}`);
      return false;
    }
  }

  /**
   * Obtiene credenciales de Zoom desde variables de entorno
   */
  private getZoomCredentials(): { accountId: string; clientId: string; clientSecret: string } {
    const accountId =
      this.configService.get<string>('ZOOM_ACCOUNT_ID') ||
      this.configService.get<string>('VITE_ZOOM_ACCOUNT_ID');
    const clientId =
      this.configService.get<string>('ZOOM_CLIENT_ID') ||
      this.configService.get<string>('VITE_ZOOM_CLIENT_ID');
    const clientSecret =
      this.configService.get<string>('ZOOM_CLIENT_SECRET') ||
      this.configService.get<string>('VITE_ZOOM_CLIENT_SECRET');

    if (!accountId || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Las credenciales de Zoom (ACCOUNT_ID, CLIENT_ID, CLIENT_SECRET) no están configuradas en el servidor.',
      );
    }

    return {
      accountId: accountId.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    };
  }

  /**
   * Genera o reutiliza un Access Token Server-to-Server OAuth de Zoom
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60000) {
      return this.cachedToken.token;
    }

    const { accountId, clientId, clientSecret } = this.getZoomCredentials();

    try {
      const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
        accountId,
      )}`;

      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {},
          {
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          },
        ),
      );

      const tokenData = response.data;
      if (!tokenData?.access_token) {
        throw new Error('No se recibió access_token en la respuesta de Zoom');
      }

      const expiresInSec = tokenData.expires_in || 3600;
      this.cachedToken = {
        token: tokenData.access_token,
        expiresAt: now + (expiresInSec - 120) * 1000,
      };

      this.logger.log('Nuevo Access Token de Zoom obtenido satisfactoriamente');
      return this.cachedToken.token;
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      this.logger.error(`Error al autenticar con la API de Zoom OAuth: ${errorMsg}`);
      throw new InternalServerErrorException(
        `Error al autenticar con la API de Zoom: ${errorMsg}`,
      );
    }
  }

  /**
   * Crea una reunión en Zoom Cloud
   */
  async createMeeting(userId: string, dto: CreateZoomMeetingDto): Promise<ZoomMeetingResponse> {
    // 1. Verificación de permisos y rol
    const hasPermission = await this.validateUserRole(userId);
    if (!hasPermission) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para aprobar o crear reuniones de Zoom.',
      );
    }

    // 2. Validación de inputs
    if (!dto.topic || !dto.topic.trim()) {
      throw new BadRequestException('El tema (topic) de la reunión es obligatorio.');
    }
    if (!dto.startTime) {
      throw new BadRequestException('La fecha y hora de inicio (startTime) es obligatoria.');
    }

    const startTimestamp = new Date(dto.startTime).getTime();
    if (isNaN(startTimestamp)) {
      throw new BadRequestException('El formato de startTime no es una fecha válida ISO 8601.');
    }

    const duration = dto.durationMinutes && dto.durationMinutes > 0 ? dto.durationMinutes : 60;
    if (duration > 480) {
      throw new BadRequestException('La duración máxima permitida es de 480 minutos (8 horas).');
    }

    // 3. Obtener Access Token
    const accessToken = await this.getAccessToken();

    // 4. Invocar endpoint de Zoom Meetings
    const zoomPayload = {
      topic: dto.topic.trim(),
      type: 2, // Scheduled meeting
      start_time: new Date(dto.startTime).toISOString(),
      duration: duration,
      timezone: 'America/Santiago',
      agenda: dto.agenda?.trim() || '',
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: true,
        watermark: false,
        use_pmi: false,
        approval_type: 0, // Automatically approve
        audio: 'both',
        auto_recording: dto.cloudRecording ? 'cloud' : 'none',
        waiting_room: true,
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post('https://api.zoom.us/v2/users/me/meetings', zoomPayload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }),
      );

      const meetingData = response.data;

      this.logger.log(
        `Reunión de Zoom creada con éxito: ID ${meetingData.id} para tema "${dto.topic}"`,
      );

      return {
        id: String(meetingData.id),
        topic: meetingData.topic,
        joinUrl: meetingData.join_url,
        startUrl: meetingData.start_url,
        password: meetingData.password || undefined,
        startTime: meetingData.start_time,
        duration: meetingData.duration,
      };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      this.logger.error(`Error al crear reunión en Zoom API: ${errorMsg}`);
      throw new InternalServerErrorException(
        `Error al crear reunión en Zoom: ${errorMsg}`,
      );
    }
  }
}


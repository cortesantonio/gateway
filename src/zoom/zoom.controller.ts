import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ZoomService } from './zoom.service';
import { CreateZoomMeetingDto, ZoomMeetingResponse } from './dto/create-zoom-meeting.dto';

interface AuthenticatedRequest {
  user?: {
    id?: string;
    email?: string;
  };
}

@Controller('zoom')
export class ZoomController {
  private readonly logger = new Logger(ZoomController.name);

  constructor(private readonly zoomService: ZoomService) {}

  /**
   * Health check para validar que el servicio de Zoom está configurado
   */
  @Get('health')
  healthCheck() {
    return { status: 'ok', service: 'zoom' };
  }

  /**
   * Crea una reunión en Zoom Cloud validando token de Supabase y roles de administración
   */
  @Post('meetings')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SupabaseAuthGuard)
  async createMeeting(
    @Body() dto: CreateZoomMeetingDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ZoomMeetingResponse> {
    const userId = req.user?.id || '';
    this.logger.log(`Solicitud de creación de reunión Zoom recibida del usuario: ${userId}`);
    return await this.zoomService.createMeeting(userId, dto);
  }
}


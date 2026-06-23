/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { TratoDirectoService } from './trato-directo.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('mercadopublico/tratos-directos')
@UseGuards(SupabaseAuthGuard)
export class TratoDirectoController {
  constructor(private readonly tratoDirectoService: TratoDirectoService) {}

  /**
   * Obtiene los detalles de un Trato Directo directamente en tiempo real desde la API de ChileCompra (sin persistir)
   */
  @Get('external/:idFicha')
  async getExternalDetail(
    @Param('idFicha') idFicha: string,
    @Headers('x-mp-token') overrideToken?: string,
  ) {
    return this.tratoDirectoService.findOneFromChileCompra(
      idFicha,
      overrideToken,
    );
  }

  /**
   * Sincroniza o importa un Trato Directo específico por su código (idFicha). Guarda/actualiza en la BD local.
   */
  @Post('sync/:idFicha')
  @HttpCode(HttpStatus.OK)
  async syncByIdFicha(
    @Param('idFicha') idFicha: string,
    @Query('group_id') groupId: string,
    @Headers('x-mp-token') overrideToken?: string,
    @Req() req?: any,
  ) {
    const actorId = req?.user?.id; // Extraído por SupabaseAuthGuard
    return this.tratoDirectoService.syncByIdFicha(
      idFicha,
      actorId,
      groupId,
      overrideToken,
    );
  }
}

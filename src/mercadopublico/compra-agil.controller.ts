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
} from '@nestjs/common';
import { CompraAgilService } from './compra-agil.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('mercadopublico/compras-agiles')
@UseGuards(SupabaseAuthGuard)
export class CompraAgilController {
  constructor(private readonly compraAgilService: CompraAgilService) {}

  /**
   * Obtiene los detalles de una Compra Ágil directamente en tiempo real desde la API de ChileCompra (sin persistir)
   */
  @Get('external/:codigo')
  async getExternalDetail(@Param('codigo') codigo: string) {
    return this.compraAgilService.findOneFromChileCompra(codigo);
  }

  /**
   * Busca Compras Ágiles en la API externa del Buscador de Mercado Público.
   */
  @Get('buscador-external')
  async searchBuscadorExternal(
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('keywords') keywords?: string,
    @Query('status') status?: string,
  ) {
    return this.compraAgilService.searchBuscadorExternal({
      date_from: dateFrom,
      date_to: dateTo,
      keywords,
      status,
    });
  }

  /**
   * Sincroniza o importa una Compra Ágil específica por su código. Guarda/actualiza en la BD local.
   */
  @Post('sync/:codigo')
  @HttpCode(HttpStatus.OK)
  async syncByCode(
    @Param('codigo') codigo: string,
    @Query('group_id') groupId: string,
    @Req() req: any,
  ) {
    const actorId = req.user?.id; // Extraído por SupabaseAuthGuard
    return this.compraAgilService.syncByCode(
      codigo,
      actorId,
      'manual',
      groupId,
    );
  }
}

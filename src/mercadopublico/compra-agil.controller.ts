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
   * Sincroniza o importa una Compra Ágil específica por su código. Guarda/actualiza en la BD local.
   */
  @Post('sync/:codigo')
  @HttpCode(HttpStatus.OK)
  async syncByCode(@Param('codigo') codigo: string, @Req() req: any) {
    const actorId = req.user?.id; // Extraído por SupabaseAuthGuard
    return this.compraAgilService.syncByCode(codigo, actorId, 'manual');
  }

  /**
   * Fuerza una sincronización incremental de Compras Ágiles.
   * Útil para probar el flujo de actualización o sincronizar manualmente ventanas de tiempo.
   */
  @Post('sync-incremental')
  @HttpCode(HttpStatus.OK)
  async syncIncremental(
    @Query('ttl_cambio_ms') ttl?: string,
    @Query('cambio_desde') desde?: string,
    @Query('cambio_hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Query('region') region?: string,
  ) {
    const ttlMs = ttl ? parseInt(ttl, 10) : undefined;
    return this.compraAgilService.syncIncremental({
      ttl_cambio_ms: ttlMs,
      cambio_desde: desde,
      cambio_hasta: hasta,
      estado,
      region,
    });
  }
}

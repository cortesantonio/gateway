import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MercadoPublicoService } from './mercadopublico.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('mercadopublico')
@UseGuards(SupabaseAuthGuard)
export class MercadoPublicoController {
  constructor(private readonly mpService: MercadoPublicoService) {}

  @Get('licitaciones')
  findAll(@Query('fecha') fecha?: string) {
    return this.mpService.findAll(fecha);
  }

  @Get('licitaciones/search')
  search(@Query('q') query: string) {
    return this.mpService.searchSimilar(query);
  }

  @Get('licitaciones/search-similar')
  searchSimilar(@Query('q') query: string) {
    return this.mpService.searchSimilar(query);
  }

  @Get('licitaciones/:codigo')
  findOne(@Param('codigo') codigo: string) {
    return this.mpService.findOne(codigo);
  }
}

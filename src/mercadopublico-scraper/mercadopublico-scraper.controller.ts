import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { MercadoPublicoScraperService, ScraperResult } from './mercadopublico-scraper.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('mercadopublico-web')
@UseGuards(SupabaseAuthGuard)
export class MercadoPublicoScraperController {
  constructor(private readonly scraperService: MercadoPublicoScraperService) {}

  @Get('search')
  async search(@Query('q') query: string): Promise<{ totalFound: number; count: number; results: ScraperResult[] } | { error: string }> {
    if (!query) {
      return { error: 'Debe proporcionar un término de búsqueda (parámetro q)' };
    }
    return this.scraperService.searchAll(query);
  }

  @Post('consultar-oc')
  async consultarOC(@Body('id') id: string) {
    if (!id) {
      return { error: 'Debe proporcionar un ID de licitación' };
    }
    return this.scraperService.consultarOC(id);
  }
}

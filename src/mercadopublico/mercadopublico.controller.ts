import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MercadoPublicoService } from './mercadopublico.service';
import { MercadoPublicoSyncService } from './mercadopublico-sync.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('mercadopublico')
@UseGuards(SupabaseAuthGuard)
export class MercadoPublicoController {
  constructor(
    private readonly mpService: MercadoPublicoService,
    private readonly syncService: MercadoPublicoSyncService,
  ) {}

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

  @Get('ordenes-compra/:codigo')
  findOrdenCompra(@Param('codigo') codigo: string) {
    return this.mpService.findOrdenCompra(codigo);
  }

  @Post('sync/all')
  @HttpCode(HttpStatus.OK)
  async syncAll() {
    return this.syncService.syncAllActive();
  }

  @Post('sync/licitaciones')
  @HttpCode(HttpStatus.OK)
  async syncLicitaciones() {
    return this.syncService.syncLicitaciones();
  }

  @Post('sync/compras-agiles')
  @HttpCode(HttpStatus.OK)
  async syncComprasAgiles() {
    return this.syncService.syncComprasAgiles();
  }

  @Post('sync/tratos-directos')
  @HttpCode(HttpStatus.OK)
  async syncTratosDirectos() {
    return this.syncService.syncTratosDirectos();
  }

  @Get('sync/status')
  async getSyncStatus() {
    return this.syncService.getLastSyncStatus();
  }
}

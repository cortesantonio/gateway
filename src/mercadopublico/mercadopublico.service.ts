import { Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MercadoPublicoService {
  private readonly baseUrl =
    'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';
  private readonly webhookUrl: string;
  private readonly ticket: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.ticket =
      this.configService.get<string>('MERCADO_PUBLICO_TICKET') || '';
    this.webhookUrl =
      this.configService.get<string>('MERCADO_PUBLICO_WEBHOOK_URL') || '';
  }

  /**
   * Cron job que se ejecuta cada 30 minutos para refrescar el cache de las licitaciones desde el webhook.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {
    console.log(
      '[MercadoPublico] CRON: Iniciando actualización automática desde webhook...',
    );
    await this.findAll();
    console.log('[MercadoPublico] CRON: Cache actualizado exitosamente.');
  }

  /**
   * Obtiene todas las licitaciones filtradas (2445) desde el webhook interno.
   * @param fecha Originalmente para fecha, ahora el webhook ya entrega las relevantes.
   */
  async findAll(fecha?: string) {
    const cacheKey = `mp_list_${fecha || 'filtered'}`;
    const cachedData = await this.cacheManager.get(cacheKey);

    if (cachedData) {
      console.log(`[MercadoPublico] Cache HIT [Webhook] for key: ${cacheKey}`);
      return cachedData;
    }

    try {
      console.log(
        `[MercadoPublico] API CALL: Fetching list from internal webhook...`,
      );
      const { data } = await firstValueFrom(
        this.httpService.get(this.webhookUrl),
      );

      if (!Array.isArray(data) || data.length === 0) {
        return {
          Cantidad: 0,
          Listado: [],
          message: 'No se encontraron licitaciones en el webhook',
        };
      }

      // Transformamos el array del webhook al formato estándar de Mercado Publico
      // para mantener compatibilidad con lo existente.
      const listado = data.map((item: any) => ({
        CodigoExterno: item.id_licitacion,
        Nombre: item.titulo,
        MontoEstimado: item.monto,
        Estado: item.estado,
        UrlFicha: item.url_ficha,
        // Agregamos el resto de campos que podrían venir, por si acaso
        ...item,
      }));

      const transformedData = {
        Cantidad: listado.length,
        Listado: listado,
      };

      // Guardar en cache el resultado transformado
      await this.cacheManager.set(cacheKey, transformedData);
      return transformedData;
    } catch (error) {
      console.error('[MercadoPublico] Error calling webhook:', error.message);
      throw new HttpException(
        'Error al conectar con el webhook interno de licitaciones',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Obtiene el detalle de una licitación específica por su código.
   * SIEMPRE EN TIEMPO REAL desde la API OFICIAL (mercadopublico.cl).
   * @param codigo Código de la licitación (ej. 1509-5-L115)
   */
  async findOne(codigo: string) {
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.append('ticket', this.ticket);
      url.searchParams.append('codigo', codigo);

      console.log(
        `[MercadoPublico] API CALL (REAL-TIME OFFICIAL): Fetching detail for ${codigo}`,
      );
      const { data } = await firstValueFrom(
        this.httpService.get(url.toString()),
      );

      if (!data || data.Cantidad === 0) {
        throw new HttpException(
          'Licitación no encontrada en Mercado Público',
          HttpStatus.NOT_FOUND,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.response?.data ||
          'Error al consultar detalle oficial de licitación',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Obtiene el detalle de una orden de compra específica por su código.
   * SIEMPRE EN TIEMPO REAL desde la API OFICIAL.
   * @param codigo Código de la OC (ej. 1234-56-SE23)
   */
  async findOrdenCompra(codigo: string) {
    try {
      const url = new URL(
        'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json',
      );
      url.searchParams.append('ticket', this.ticket);
      url.searchParams.append('codigo', codigo);

      console.log(
        `[MercadoPublico] API CALL (REAL-TIME OFFICIAL): Fetching OC for ${codigo}`,
      );
      const { data } = await firstValueFrom(
        this.httpService.get(url.toString()),
      );

      if (!data || data.Cantidad === 0) {
        throw new HttpException(
          'Orden de Compra no encontrada en Mercado Público',
          HttpStatus.NOT_FOUND,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.response?.data ||
          'Error al consultar detalle oficial de Orden de Compra',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Busca licitaciones por similitud básica en el listado ya filtrado del webhook.
   */
  async searchSimilar(query: string) {
    const cacheKey = `mp_search_${query.toLowerCase()}`;
    const cachedData = await this.cacheManager.get(cacheKey);

    if (cachedData) {
      console.log(`[MercadoPublico] Cache HIT for key: ${cacheKey}`);
      return cachedData;
    }

    // Usamos findAll (que ya consulta el webhook y tiene su propio cache)
    const webhookData: any = await this.findAll();
    if (!webhookData || !webhookData.Listado)
      return { Cantidad: 0, Listado: [] };

    const filtered = webhookData.Listado.filter(
      (l: any) =>
        l.Nombre?.toLowerCase().includes(query.toLowerCase()) ||
        l.CodigoExterno?.toLowerCase().includes(query.toLowerCase()),
    );

    const result = {
      Cantidad: filtered.length,
      Listado: filtered,
    };

    // Guardamos el resultado del filtro específico en cache
    await this.cacheManager.set(cacheKey, result);
    return result;
  }
}

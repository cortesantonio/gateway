/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../auth/supabase.service';

@Injectable()
export class CompraAgilService {
  private readonly logger = new Logger(CompraAgilService.name);
  private readonly baseUrl = 'https://api2.mercadopublico.cl/v2/compra-agil';
  private readonly ticket: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.ticket =
      this.configService.get<string>('MERCADO_PUBLICO_TICKET') || '';
  }

  /**
   * Helper to perform authenticated HTTP requests to the ChileCompra V2 API
   */
  private async callApi<T>(
    endpoint: string,
    params: Record<string, any> = {},
  ): Promise<T> {
    if (!this.ticket) {
      throw new HttpException(
        'MERCADO_PUBLICO_TICKET no configurado en el servidor backend',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const url = `${this.baseUrl}${endpoint}`;
      const headers = { ticket: this.ticket };

      const response = await firstValueFrom(
        this.httpService.get(url, { headers, params }),
      );

      const body = response.data;
      if (body?.success === 'NOK') {
        const err = body.errors?.[0];
        const statusCode = err?.codigo
          ? parseInt(err.codigo, 10)
          : HttpStatus.BAD_REQUEST;
        throw new HttpException(
          err?.mensaje ||
            'Error en la respuesta de la API externa de Compra Ágil',
          statusCode || HttpStatus.BAD_REQUEST,
        );
      }

      return body?.payload;
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const status = error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const data = error.response?.data;

      this.logger.error(
        `Error calling ChileCompra V2 API: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        data?.errors?.[0]?.mensaje ||
          error.message ||
          'Error al conectar con la API de ChileCompra',
        status,
      );
    }
  }

  /**
   * Fetches the detailed payload of a single Compra Ágil from ChileCompra
   */
  async findOneFromChileCompra(codigo: string) {
    // Normalizar formato del código (eliminar espacios que a veces se extraen de PDFs/textos)
    const cleanCodigo = codigo.replace(/\s+/g, '');
    const cacheKey = `compra_agil_detail_ext_${cleanCodigo}`;

    // Cache de lectura temporal para no agotar la cuota si se consulta repetidamente en segundos
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const data = await this.callApi<any>(`/${cleanCodigo}`);

    await this.cacheManager.set(cacheKey, data, 60 * 1000); // 1 minuto de cache
    return data;
  }

  /**
   * Performs an incremental sync of Compras Ágiles modified in a specific window
   */
  async syncIncremental(
    params: {
      ttl_cambio_ms?: number;
      cambio_desde?: string;
      cambio_hasta?: string;
      estado?: string;
      region?: string;
    } = {},
  ) {
    this.logger.log(
      `Starting incremental sync with parameters: ${JSON.stringify(params)}`,
    );

    const apiParams: Record<string, any> = {
      tamano_pagina: 50,
      numero_pagina: 1,
      ordenar_por: 'FechaUltimaModificacion',
    };

    if (params.ttl_cambio_ms) {
      apiParams.ttl_cambio_ms = params.ttl_cambio_ms;
    } else if (params.cambio_desde) {
      apiParams.cambio_desde = params.cambio_desde;
      if (params.cambio_hasta) apiParams.cambio_hasta = params.cambio_hasta;
    } else {
      // Por defecto sincronizar los cambios de las últimas 24 horas (86400000 ms)
      apiParams.ttl_cambio_ms = 86400000;
    }

    if (params.estado) apiParams.estado = params.estado;
    if (params.region) apiParams.region = params.region;

    let totalSincronizadas = 0;
    const errors: any[] = [];

    try {
      while (true) {
        const payload = await this.callApi<any>('', apiParams);
        if (
          !payload ||
          !payload.items ||
          !Array.isArray(payload.items) ||
          payload.items.length === 0
        ) {
          break;
        }

        this.logger.log(
          `Syncing page ${apiParams.numero_pagina} with ${payload.items.length} items`,
        );

        for (const item of payload.items) {
          try {
            await this.syncByCode(item.codigo, undefined, 'automatico');
            totalSincronizadas++;
          } catch (err) {
            this.logger.error(
              `Failed to sync item ${item.codigo}: ${err.message}`,
            );
            errors.push({ codigo: item.codigo, error: err.message });
          }
        }

        const paginacion = payload.paginacion;
        if (
          !paginacion ||
          paginacion.numero_pagina >= paginacion.total_paginas
        ) {
          break;
        }
        apiParams.numero_pagina++;
      }

      this.logger.log(
        `Incremental sync completed. Successfully synced: ${totalSincronizadas}`,
      );
      return { success: true, synced_count: totalSincronizadas, errors };
    } catch (error) {
      this.logger.error(`Error during incremental sync: ${error.message}`);
      throw error;
    }
  }

  /**
   * Main orchestrator of the syncing process for a single Compra Ágil code.
   * Feches, normalizes, persists, links OCs and logs audit events.
   */
  async syncByCode(
    codigo: string,
    actorId?: string,
    origen: string = 'manual',
  ) {
    this.logger.log(
      `Syncing Compra Ágil ${codigo} (Actor: ${actorId || 'system'}, Origen: ${origen})`,
    );

    // 1. Fetch details
    const extDetail = await this.findOneFromChileCompra(codigo);
    if (!extDetail) {
      throw new HttpException(
        'No se recibió información de la API de Mercado Público para el código dado',
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. Normalizer
    const normalized = this.normalizeCompraAgil(extDetail, origen);

    // 3. Persist and Log audit
    const adminDb = this.supabaseService.getAdminClient();

    // Check if it already exists
    const { data: existing, error: fetchError } = await adminDb
      .from('compras_agiles')
      .select('*')
      .eq('codigo_compra_agil', normalized.codigo_compra_agil)
      .maybeSingle();

    if (fetchError) {
      throw new HttpException(
        `Error al consultar existencia local de Compra Ágil: ${fetchError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    let savedRecord: any = null;
    let statusMpChanged = false;
    let oldStatusMp = '';

    // Search for corresponding local Orden Compra if one exists in payload
    let finalOrdenCompraId = existing?.orden_compra_id || null;
    let codeOc = extDetail.orden_compra?.codigo_orden_compra;
    const internalOcId =
      extDetail.orden_compra?.id_orden_compra || extDetail.orden_compra?.id_oc;

    if (internalOcId || codeOc) {
      // Intentar buscar en la base de datos de órdenes de compra
      let ocQuery = adminDb.from('ordenes_compra').select('id, codigo_oc');
      if (codeOc) {
        ocQuery = ocQuery.eq('codigo_oc', codeOc);
      } else {
        ocQuery = ocQuery.eq(
          'datos_mp->>id_orden_compra',
          internalOcId.toString(),
        );
      }

      const { data: localOc } = await ocQuery.maybeSingle();
      if (localOc) {
        finalOrdenCompraId = localOc.id;
        if (!codeOc) codeOc = localOc.codigo_oc;
      }
    }

    normalized.orden_compra_id = finalOrdenCompraId;

    if (!existing) {
      // Default internal state is 'pendiente_revision'
      normalized.estado_interno = 'pendiente_revision';

      const { data: inserted, error: insertError } = await adminDb
        .from('compras_agiles')
        .insert([normalized])
        .select()
        .single();

      if (insertError) {
        throw new HttpException(
          `Error al insertar Compra Ágil: ${insertError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      savedRecord = inserted;

      // Log import event
      await this.logHito(
        adminDb,
        savedRecord.id,
        'importada',
        `Compra Ágil importada desde Mercado Público en estado: ${savedRecord.estado_mp} (Glosa: ${extDetail.estado?.glosa || 'N/A'})`,
        actorId,
        null,
        { estado_mp: savedRecord.estado_mp },
      );

      // If OC is linked at import
      if (finalOrdenCompraId) {
        await this.logHito(
          adminDb,
          savedRecord.id,
          'orden_compra_vinculada',
          `Orden de Compra vinculada automáticamente durante importación: ${codeOc || 'ID ' + finalOrdenCompraId}`,
          actorId,
          null,
          { orden_compra_id: finalOrdenCompraId, codigo_oc: codeOc },
        );
      }
    } else {
      // Preserve local state fields we do not overwrite from API
      normalized.estado_interno = existing.estado_interno;
      if (existing.responsable_id)
        normalized.responsable_id = existing.responsable_id;
      if (existing.licitacion_id)
        normalized.licitacion_id = existing.licitacion_id;

      // If we already have a manually linked OC, preserve it if API doesn't specify one
      if (existing.orden_compra_id && !normalized.orden_compra_id) {
        normalized.orden_compra_id = existing.orden_compra_id;
      }

      // Check if external state changed
      if (existing.estado_mp !== normalized.estado_mp) {
        statusMpChanged = true;
        oldStatusMp = existing.estado_mp;
      }

      const { data: updated, error: updateError } = await adminDb
        .from('compras_agiles')
        .update(normalized)
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        throw new HttpException(
          `Error al actualizar Compra Ágil: ${updateError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      savedRecord = updated;

      // Log execution of synchronization
      await this.logHito(
        adminDb,
        savedRecord.id,
        'sincronizacion_ejecutada',
        `Sincronización ejecutada exitosamente (${origen})`,
        actorId,
        null,
        null,
      );

      // Log state change if it happened
      if (statusMpChanged) {
        await this.logHito(
          adminDb,
          savedRecord.id,
          'estado_mp_actualizado',
          `Estado de Mercado Público cambió de "${oldStatusMp}" a "${savedRecord.estado_mp}"`,
          actorId,
          { estado_mp: oldStatusMp },
          { estado_mp: savedRecord.estado_mp },
        );
      }

      // If OC was newly linked
      if (
        finalOrdenCompraId &&
        existing.orden_compra_id !== finalOrdenCompraId
      ) {
        await this.logHito(
          adminDb,
          savedRecord.id,
          'orden_compra_vinculada',
          `Orden de Compra vinculada automáticamente durante sincronización: ${codeOc || 'ID ' + finalOrdenCompraId}`,
          actorId,
          existing.orden_compra_id
            ? { orden_compra_id: existing.orden_compra_id }
            : null,
          { orden_compra_id: finalOrdenCompraId, codigo_oc: codeOc },
        );
      }
    }

    return savedRecord;
  }

  /**
   * Normalizes the V2 response body to the database schema structure
   */
  private normalizeCompraAgil(
    payload: any,
    origen: string,
  ): Record<string, any> {
    const dates = payload.fechas || {};
    const budget = payload.presupuesto || {};
    const inst = payload.institucion || {};
    const state = payload.estado || {};
    const conv = payload.convocatoria || {};

    // Determinar el proveedor ganador/seleccionado y montos
    let selectedProviderName: string | null = null;
    let selectedProviderRut: string | null = null;
    let amountAdjudicado: number | null = null;

    if (
      payload.proveedores_cotizando &&
      Array.isArray(payload.proveedores_cotizando)
    ) {
      const isWinnerState = (estado: any): boolean => {
        if (estado === undefined || estado === null) return false;
        
        // If it is a primitive type (string, number, etc.)
        if (typeof estado !== 'object') {
          const upper = String(estado).toUpperCase();
          return (
            upper === 'SELECCIONADA' ||
            upper === 'ADJUDICADA' ||
            upper === 'SELECCIONADO' ||
            upper === 'ADJUDICADO' ||
            upper === '4' ||
            upper === '3' ||
            upper === '1'
          );
        }
        
        // If it is an object
        const glosa = estado.glosa ? String(estado.glosa).toUpperCase() : '';
        const codigo = estado.codigo ? String(estado.codigo).toUpperCase() : '';
        return (
          glosa === 'SELECCIONADA' ||
          glosa === 'ADJUDICADA' ||
          glosa === 'SELECCIONADO' ||
          glosa === 'ADJUDICADO' ||
          codigo === 'SELECCIONADA' ||
          codigo === 'ADJUDICADA' ||
          codigo === '4' ||
          codigo === '3' ||
          codigo === '1'
        );
      };

      // Buscar proveedor ganador
      const winner = payload.proveedores_cotizando.find(
        (prov: any) =>
          prov.proveedor_seleccionado === 1 ||
          prov.proveedor_seleccionado === true ||
          String(prov.proveedor_seleccionado) === '1' ||
          String(prov.proveedor_seleccionado) === 'true' ||
          prov.seleccion?.proveedor_seleccionado === true ||
          prov.seleccion?.proveedor_seleccionado === 'true' ||
          String(prov.seleccion?.proveedor_seleccionado) === '1' ||
          isWinnerState(prov.estado_por_comprador),
      );

      if (winner) {
        selectedProviderRut = winner.rut_proveedor;
        selectedProviderName = winner.razon_social;
        amountAdjudicado = winner.monto_total || winner.valor_neto || null;
      }
    }

    // Si hay un monto de adjudicación en la OC, o info en OC, lo cruzamos
    const estAmount =
      budget.presupuesto_estimado ||
      budget.monto_disponible_clp ||
      budget.monto_disponible ||
      0;

    return {
      codigo_compra_agil: payload.codigo,
      nombre: payload.nombre || 'Sin Nombre',
      descripcion: payload.descripcion || '',
      estado_mp: state.codigo || 'publicada',
      convocatoria_etapa: conv.estado_convocatoria || 1,
      convocatoria_descripcion: conv.descripcion || 'Primer llamado',
      fecha_publicacion: dates.fecha_publicacion || null,
      fecha_cierre: dates.fecha_cierre || null,
      fecha_adjudicacion:
        dates.fecha_adjudicacion || dates.fecha_ultimo_cambio || null, // V2 fecha de adjudicación o último cambio
      fecha_cancelacion: dates.fecha_cancelacion || null,
      fecha_ultimo_cambio_mp: dates.fecha_ultimo_cambio || null,
      proveedor_seleccionado: selectedProviderName,
      proveedor_rut: selectedProviderRut,
      proveedor_nombre: selectedProviderName,
      organismo_rut: inst.rut || '',
      organismo_nombre: inst.organismo_comprador || '',
      organismo_unidad: inst.unidad_compra || '',
      organismo_region: inst.region || null,
      organismo_nombre_region: inst.nombre_region || '',
      monto_estimado: estAmount,
      monto_adjudicado: amountAdjudicado,
      moneda: budget.moneda || 'CLP',
      origen: origen,
      ultima_sincronizacion_mp: new Date().toISOString(),
      datos_mp: payload,
    };
  }

  /**
   * Helper to write a log event in the compras_agiles_hitos table
   */
  private async logHito(
    db: any,
    compraAgilId: number,
    tipoEvento: string,
    descripcion: string,
    actorId?: string,
    datosPrevios: any = null,
    datosNuevos: any = null,
  ) {
    try {
      const { error } = await db.from('compras_agiles_hitos').insert({
        compra_agil_id: compraAgilId,
        tipo_evento: tipoEvento,
        descripcion,
        actor_id: actorId || null,
        datos_previos: datosPrevios,
        datos_nuevos: datosNuevos,
      });
      if (error) {
        this.logger.error(`Error saving audit log: ${error.message}`);
      }
    } catch (e) {
      this.logger.error(`Failed to log hito: ${e.message}`);
    }
  }

  /**
   * Scheduled cron job running every hour to execute automatic incremental synchronization
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleSyncCron() {
    this.logger.log(
      'CRON: Iniciando sincronización automática programada de Compras Ágiles...',
    );
    try {
      // Sincronizar cambios de las últimas 2 horas para tener holgura
      const result = await this.syncIncremental({
        ttl_cambio_ms: 2 * 60 * 60 * 1000,
      });
      this.logger.log(
        `CRON: Sincronización automática finalizada. Sincronizadas: ${result.synced_count}`,
      );
    } catch (error) {
      this.logger.error(
        `CRON: Error en la sincronización programada: ${error.message}`,
      );
    }
  }
}

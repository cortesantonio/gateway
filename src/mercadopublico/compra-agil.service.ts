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
        this.httpService.get(url, { headers, params, timeout: 10000 }),
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

      if (status === 504 || error.code === 'ECONNABORTED' || error.message?.includes('504')) {
        this.logger.warn(
          `ChileCompra V2 API 504 Timeout (${endpoint}). El servidor de Mercado Público no respondió en 10s.`,
        );
      } else {
        this.logger.error(
          `Error calling ChileCompra V2 API: ${error.message}`,
          error.stack,
        );
      }

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
   * Main orchestrator of the syncing process for a single Compra Ágil code.
   * Feches, normalizes, persists, links OCs and logs audit events.
   */
  async syncByCode(
    codigo: string,
    actorId?: string,
    origen: string = 'manual',
    groupId?: string,
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
      if (groupId) {
        normalized.group_id =
          typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
      }
      if (actorId) normalized.creado_por = actorId;

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

      // If it doesn't have a group, associate it with the importing group
      if (!existing.group_id && groupId) {
        normalized.group_id =
          typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
      } else {
        normalized.group_id = existing.group_id;
      }

      normalized.creado_por = existing.creado_por || actorId || null;
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

      // Si la compra ágil ya existe en otro grupo, la compartimos con el nuevo grupo importador
      if (
        groupId &&
        existing.group_id &&
        existing.group_id.toString() !== groupId.toString()
      ) {
        const { error: shareError } = await adminDb
          .from('compra_agil_compartida')
          .upsert(
            {
              compra_agil_id: existing.id,
              group_id:
                typeof groupId === 'string' ? parseInt(groupId, 10) : groupId,
              permiso: 'ver',
            },
            { onConflict: 'compra_agil_id,group_id' },
          );
        if (shareError) {
          this.logger.error(
            `Error al compartir compra ágil al sincronizar: ${shareError.message}`,
          );
        }
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
   * Busca Compras Ágiles en la API externa del Buscador de Mercado Público recorriendo todas las páginas.
   */
  async searchBuscadorExternal(params: {
    date_from?: string;
    date_to?: string;
    keywords?: string;
    status?: string;
  }) {
    const apiParams: Record<string, any> = {
      order_by: 'recent',
      page_number: 1,
    };

    if (params.date_from) apiParams.date_from = params.date_from;
    if (params.date_to) apiParams.date_to = params.date_to;
    if (params.keywords) apiParams.keywords = params.keywords;
    if (params.status) apiParams.status = params.status;

    const apiKey =
      this.configService.get<string>('MERCADO_PUBLICO_BUSCADOR_API_KEY') ||
      'e93089e4-437c-4723-b343-4fa20045e3bc';
    const token =
      this.configService.get<string>('MERCADO_PUBLICO_BUSCADOR_TOKEN') ||
      'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICI2Rk1NaXFwVWRLY3Ryb0IweXgwRWdKWS1xVDZIVDBEQXgyR3JvWFlja25JIn0.eyJleHAiOjE3ODA2MDQ0OTAsImlhdCI6MTc4MDU3NTY5MCwianRpIjoiYWRlN2QyN2ItMTFhMy00OGFlLWIyNTYtOGU3YjZhY2RiOTRlIiwiaXNzIjoiaHR0cHM6Ly9oZWltZGFsbC5tZXJjYWRvcHVibGljby5jbC9hdXRoL3JlYWxtcy9jaGlsZWNvbXByYXJlYWxtIiwiYXVkIjoiYWNjb3VudCIsInN1YiI6Ijk3NGRiNzU3LTc2NjEtNDdjMC04MDlhLTlkZTExZGZkYzQ0NiIsInR5cCI6IkJlYXJlciIsImF6cCI6Im1lcmNhZG9QdWJsaWNvQ2xpZW50Iiwic2lkIjoiZWVjMzlkY2EtZWQ2Ni00ZGJjLWFlNzAtMzcxZTYwOTlmNWIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbIioiXSwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbIm9mZmxpbmVfYWNjZXNzIiwidW1hX2F1dGhvcml6YXRpb24iLCJwdWJsaWNvIl19LCJyZXNvdXJjZV9hY2Nlc3MiOnsiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJvcGVuaWQgZW1haWwgcHJvZmlsZSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwicHJlZmVycmVkX3VzZXJuYW1lIjoiYW5vbmltb3VzZXIifQ.NaoSYuSbY7fmwu-_NaGxZjQZw9KYcewWbwwmNcVz_atFMw50CgfOvXjhuQspgq8mOIgkaKzwNlQ8BA-RL2oY6GWBcU3Hoa2J3-mueNYKsVptNtAgjS_qRQKaFbEpIzfmJXm5BnSOQu9XQK7g_S9YtVxuJVQ77oeQ5F31vqeh8mnCm3fFSkz9COyYtJiXI61noLsCzd0VdgKCU-KZDHiMTwRpw0KuRGNb3DFjZrWD6nbXSLPyrcLaYw91aPSo-_IW10ZgHvVzeMm5rYMvZNTP10sciB5Mn0gglxwBG1n_iNk3VDTzav6t-MVyePp1p0wU5ssd3JwAr-iS-vUKW_8u9A';

    const headers = {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'es-ES,es;q=0.5',
      authorization: `Bearer ${token}`,
      origin: 'https://buscador.mercadopublico.cl',
      referer: 'https://buscador.mercadopublico.cl/',
      'x-api-key': apiKey,
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    };

    const url = 'https://api.buscador.mercadopublico.cl/compra-agil';
    let allResultados: any[] = [];
    let page = 1;
    let pageCount = 1;

    try {
      do {
        apiParams.page_number = page;
        this.logger.log(
          `Fetching buscador page ${page} of ${pageCount} for keywords: ${params.keywords}`,
        );
        const response = await firstValueFrom(
          this.httpService.get(url, { headers, params: apiParams }),
        );
        const data = response.data;
        if (data?.success === 'OK' && data?.payload) {
          const payload = data.payload;
          pageCount = payload.pageCount || 1;
          if (payload.resultados && Array.isArray(payload.resultados)) {
            allResultados = [...allResultados, ...payload.resultados];
          } else {
            break;
          }
        } else {
          break;
        }
        page++;
      } while (page <= pageCount);

      return {
        success: true,
        count: allResultados.length,
        resultados: allResultados,
      };
    } catch (error) {
      this.logger.error(`Error searching buscador external: ${error.message}`);
      throw new HttpException(
        error.response?.data?.message ||
          error.message ||
          'Error al conectar con el Buscador de Mercado Público',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

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
import { MercadoPublicoService } from './mercadopublico.service';

@Injectable()
export class TratoDirectoService {
  private readonly logger = new Logger(TratoDirectoService.name);
  private readonly baseUrl =
    'https://serv-trato-directo.mercadopublico.cl/v1/trato-directo-busqueda';

  // Default fallback token from user request for out-of-the-box testing
  private readonly defaultToken =
    'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICI2Rk1NaXFwVWRLY3Ryb0IweXgwRWdKWS1xVDZIVDBEQXgyR3JvWFlja25JIn0.eyJleHAiOjE3ODIyNDc2MzksImlhdCI6MTc4MjIxODgzOSwianRpIjoiMzdhMWE3MmItZDYwOS00Mzk1LWEzZTEtMzM5OTg0Yjk0OWE0IiwiaXNzIjoiaHR0cHM6Ly9oZWltZGFsbC5tZXJjYWRvcHVibGljby5jbC9hdXRoL3JlYWxtcy9jaGlsZWNvbXByYXJlYWxtIiwiYXVkIjoiYWNjb3VudCIsInN1YiI6Ijk3NGRiNzU3LTc2NjEtNDdjMC04MDlhLTlkZTExZGZkYzQ0NiIsInR5cCI6IkJlYXJlciIsImF6cCI6Im1lcmNhZG9QdWJsaWNvQ2xpZW50Iiwic2lkIjoiNWE4MjE5ZTAtMjYyYy00YmM2LWIzN2EtZmExMWZmOTE2MDE5IiwiYWxsb3dlZC1vcmlnaW5zIjpbIioiXSwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbIm9mZmxpbmVfYWNjZXNzIiwidW1hX2F1dGhvcml6YXRpb24iLCJwdWJsaWNvIl19LCJyZXNvdXJjZV9hY2Nlc3MiOnsiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJvcGVuaWQgZW1haWwgcHJvZmlsZSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwicHJlZmVycmVkX3VzZXJuYW1lIjoiYW5vbmltb3VzZXIifQ.IGhtlPyBaRinD3vl0bhAQejjsFXErp7_RrwASzO66w14oBW--_8IbFtfKNo43Pi4x9awV9dfCpc2fp_vgofvoSgPO5Ighh9lVBj03i18jXo1mHyvGGpdWYFrdXfzTj-bDU6J0dDwOx2c14LDwCONUeYXfJB2bpD9fXiz4XnWeTTMJ-7bslHzrXnncZDmSIftQ5CXvBNBm9JhW2ZXExhFz4z4JdyLHpPfb3KThmVrVgt1s1lu1_lcJExyFa63xSCwcNH67CXsovMc0mN1G97L0uwSWZgWaa777b9DhwL7Fi3SGoDCIGDivVN-l5mbBHQFBEr0wI8PAsUAshERRgjxRA';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly mercadoPublicoService: MercadoPublicoService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Fetches the detailed payload of a single Trato Directo from Mercado Público
   */
  async findOneFromChileCompra(idFicha: string, overrideToken?: string) {
    const cleanIdFicha = idFicha.replace(/\s+/g, '');
    const cacheKey = `trato_directo_detail_ext_${cleanIdFicha}`;

    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const token =
      overrideToken ||
      this.configService.get<string>('MERCADO_PUBLICO_TRATO_DIRECTO_TOKEN') ||
      this.defaultToken;

    const headers = {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'es-ES,es;q=0.5',
      authorization: `Bearer ${token}`,
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      origin: 'https://trato-directo.mercadopublico.cl',
      referer: 'https://trato-directo.mercadopublico.cl/',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'sec-gpc': '1',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    };

    try {
      this.logger.log(
        `[TratoDirecto] API CALL: Fetching detail for ${cleanIdFicha}`,
      );

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/detalle`, {
          headers,
          params: { idFicha: cleanIdFicha },
        }),
      );

      const body = response.data;
      if (body?.success !== 'OK') {
        throw new HttpException(
          body?.errores?.[0] ||
            'Error en la respuesta de la API externa de Trato Directo',
          HttpStatus.BAD_REQUEST,
        );
      }

      const payload = body?.payload;
      if (!payload) {
        throw new HttpException(
          'No se recibió el payload de la API externa',
          HttpStatus.NOT_FOUND,
        );
      }

      await this.cacheManager.set(cacheKey, payload, 60 * 1000); // 1 minuto de cache
      return payload;
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const status = error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const data = error.response?.data;

      this.logger.error(
        `Error calling Mercado Público Trato Directo API: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        data?.errores?.[0] ||
          error.message ||
          'Error al conectar con la API de Trato Directo',
        status,
      );
    }
  }

  /**
   * Synchronizes and imports a Trato Directo code to the local Supabase DB
   */
  async syncByIdFicha(
    idFicha: string,
    actorId?: string,
    groupId?: string,
    overrideToken?: string,
  ) {
    this.logger.log(
      `Syncing Trato Directo ${idFicha} (Actor: ${actorId || 'system'}, Group: ${groupId || 'none'})`,
    );

    // 1. Fetch from ChileCompra
    const extDetail = await this.findOneFromChileCompra(idFicha, overrideToken);

    // 2. Normalize fields
    const normalized = this.normalizeTratoDirecto(extDetail);

    // 3. Persist in database
    const adminDb = this.supabaseService.getAdminClient();

    // Check if it already exists
    const { data: existing, error: fetchError } = await adminDb
      .from('tratos_directos')
      .select('*')
      .eq('codigo_trato_directo', normalized.codigo_trato_directo)
      .maybeSingle();

    if (fetchError) {
      throw new HttpException(
        `Error al consultar existencia local de Trato Directo: ${fetchError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    let savedRecord: any = null;
    let statusChanged = false;
    let oldStatus = '';

    // Look up corresponding local Orden Compra if one exists in payload
    let finalOrdenCompraId = existing?.orden_compra_id || null;
    let codeOc = '';

    if (
      extDetail?.ordenEmitida &&
      Array.isArray(extDetail.ordenEmitida) &&
      extDetail.ordenEmitida.length > 0
    ) {
      const mainOc = extDetail.ordenEmitida[0];
      codeOc = mainOc.ordenCompras || mainOc.ordenCompra || '';

      if (codeOc) {
        let { data: localOc } = await adminDb
          .from('ordenes_compra')
          .select('id, codigo_oc')
          .eq('codigo_oc', codeOc)
          .maybeSingle();

        if (!localOc) {
          // Si no existe, la buscamos en Mercado Público y la guardamos en la base de datos
          try {
            this.logger.log(
              `OC ${codeOc} not found locally. Syncing with Mercado Público...`,
            );
            const ocDetail =
              await this.mercadoPublicoService.findOrdenCompra(codeOc);
            const ocData = ocDetail?.Listado?.[0];
            if (ocData) {
              const ocPayload = {
                codigo_oc: ocData.Codigo,
                proveedor_rut: ocData.Proveedor?.RutSucursal || '',
                proveedor_nombre: ocData.Proveedor?.Nombre || '',
                comprador_nombre: ocData.Comprador?.NombreOrganismo || null,
                comprador_rut: ocData.Comprador?.RutUnidad || null,
                estado_mp: ocData.Estado || '',
                monto_total: ocData.Total ? parseFloat(ocData.Total) : null,
                moneda: ocData.TipoMoneda || 'CLP',
                fecha_emision: ocData.Fechas?.FechaCreacion || null,
                fecha_aceptacion: ocData.Fechas?.FechaAceptacion || null,
                datos_mp: ocData,
                ultima_sincronizacion_mp: new Date().toISOString(),
                estado_interno: 'por_revisar',
                group_id: groupId
                  ? typeof groupId === 'string'
                    ? parseInt(groupId, 10)
                    : groupId
                  : null,
                creado_por: actorId || null,
              };

              const { data: newOc, error: insertOcError } = await adminDb
                .from('ordenes_compra')
                .insert([ocPayload])
                .select()
                .single();

              if (!insertOcError && newOc) {
                localOc = newOc;
                this.logger.log(
                  `Successfully imported OC ${codeOc} locally with ID ${newOc.id}`,
                );
              } else {
                this.logger.error(
                  `Error saving new OC ${codeOc}: ${insertOcError?.message}`,
                );
              }
            }
          } catch (ocErr) {
            this.logger.error(
              `Error fetching OC ${codeOc} on sync: ${ocErr.message}`,
            );
          }
        }

        if (localOc) {
          finalOrdenCompraId = localOc.id;
          codeOc = localOc.codigo_oc;
        }
      }
    }

    normalized.orden_compra_id = finalOrdenCompraId;

    if (!existing) {
      normalized.estado_interno = 'pendiente_revision';
      if (groupId) {
        normalized.group_id =
          typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
      }
      if (actorId) normalized.creado_por = actorId;

      const { data: inserted, error: insertError } = await adminDb
        .from('tratos_directos')
        .insert([normalized])
        .select()
        .single();

      if (insertError) {
        throw new HttpException(
          `Error al insertar Trato Directo: ${insertError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      savedRecord = inserted;

      // Log import event
      await this.logHito(
        adminDb,
        savedRecord.id,
        'importado',
        `Trato Directo importado desde Mercado Público en estado: ${savedRecord.estado}`,
        actorId,
        null,
        { estado: savedRecord.estado },
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
      // Preserve local fields
      normalized.estado_interno = existing.estado_interno;

      if (!existing.group_id && groupId) {
        normalized.group_id =
          typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
      } else {
        normalized.group_id = existing.group_id;
      }

      normalized.creado_por = existing.creado_por || actorId || null;
      if (existing.responsable_id)
        normalized.responsable_id = existing.responsable_id;

      // If we already have a manually linked OC, preserve it if API doesn't specify one
      if (existing.orden_compra_id && !normalized.orden_compra_id) {
        normalized.orden_compra_id = existing.orden_compra_id;
      }

      if (existing.estado !== normalized.estado) {
        statusChanged = true;
        oldStatus = existing.estado;
      }

      const { data: updated, error: updateError } = await adminDb
        .from('tratos_directos')
        .update(normalized)
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        throw new HttpException(
          `Error al actualizar Trato Directo: ${updateError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      savedRecord = updated;

      // Share with the new importing group if shared and not already shared
      if (
        groupId &&
        existing.group_id &&
        existing.group_id.toString() !== groupId.toString()
      ) {
        const { error: shareError } = await adminDb
          .from('trato_directo_compartido')
          .upsert(
            {
              trato_directo_id: existing.id,
              group_id:
                typeof groupId === 'string' ? parseInt(groupId, 10) : groupId,
              permiso: 'ver',
            },
            { onConflict: 'trato_directo_id,group_id' },
          );
        if (shareError) {
          this.logger.error(
            `Error sharing trato directo on sync: ${shareError.message}`,
          );
        }
      }

      // Log sync event
      await this.logHito(
        adminDb,
        savedRecord.id,
        'sincronizacion_ejecutada',
        'Sincronización ejecutada exitosamente',
        actorId,
        null,
        null,
      );

      // Log status change if it happened
      if (statusChanged) {
        await this.logHito(
          adminDb,
          savedRecord.id,
          'estado_mp_actualizado',
          `Estado de Mercado Público cambió de "${oldStatus}" a "${savedRecord.estado}"`,
          actorId,
          { estado: oldStatus },
          { estado: savedRecord.estado },
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
   * Normalizes the API response payload into the database schema format
   */
  private normalizeTratoDirecto(payload: any): Record<string, any> {
    return {
      uuid_ficha: payload.id,
      codigo_trato_directo: payload.codigoTratoDirecto,
      nombre: payload.nombre || 'Sin Nombre',
      descripcion: payload.descripcion || '',
      estado: payload.estado || '',
      causal_trato_directo: payload.causalTratoDirecto || '',
      justificacion_trato_directo: payload.justificacionTratoDirecto || '',
      fecha_publicacion: payload.fechaPublicacion || null,
      fecha_cierre: payload.fechaCierre || null,
      monto_total: payload.montoTotal ? parseFloat(payload.montoTotal) : null,
      moneda: payload.moneda || 'CLP',
      rut_proveedor: payload.rutProveedor || '',
      proveedor: payload.proveedor || '',
      duracion_contrato: payload.duracionContrato || '',
      fecha_termino_contrato: payload.fechaTerminoContrato || null,
      categoria_contrato: payload.categoriaContrato || '',
      tipo_contrato: payload.tipoContrato || '',
      direccion_entrega: payload.direccionEntrega || '',
      comuna_entrega: payload.comunaEntrega || '',
      region_entrega: payload.regionEntrega || '',
      comentario_entrega: payload.comentarioEntrega || '',
      con_publicidad:
        payload.conPublicidad !== undefined ? payload.conPublicidad : true,
      rut_comprador: payload.rutComprador || '',
      nombre_comprador: payload.nombreComprador || '',
      nombre_legal_comprador: payload.nombreLegalComprador || '',
      datos_mp: payload,
    };
  }

  /**
   * Helper to write audit logs to the hitos table
   */
  private async logHito(
    db: any,
    tratoDirectoId: number,
    tipoEvento: string,
    descripcion: string,
    actorId?: string,
    datosPrevios: any = null,
    datosNuevos: any = null,
  ) {
    try {
      const { error } = await db.from('tratos_directos_hitos').insert({
        trato_directo_id: tratoDirectoId,
        tipo_evento: tipoEvento,
        descripcion,
        actor_id: actorId || null,
        datos_previos: datosPrevios,
        datos_nuevos: datosNuevos,
      });
      if (error) {
        this.logger.error(`Error saving Trato Directo hito: ${error.message}`);
      }
    } catch (e) {
      this.logger.error(`Failed to log Trato Directo hito: ${e.message}`);
    }
  }
}

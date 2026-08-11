/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { SupabaseService } from '../auth/supabase.service';
import { MercadoPublicoService } from './mercadopublico.service';
import { CompraAgilService } from './compra-agil.service';
import { TratoDirectoService } from './trato-directo.service';

export interface SyncResultSummary {
  timestamp: string;
  durationMs: number;
  licitaciones: { processed: number; updated: number; errors: number };
  comprasAgiles: { processed: number; updated: number; errors: number };
  tratosDirectos: { processed: number; updated: number; errors: number };
  ordenesCompra: { processed: number; updated: number; errors: number };
  lastError?: string | null;
}

@Injectable()
export class MercadoPublicoSyncService {
  private readonly logger = new Logger(MercadoPublicoSyncService.name);
  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly mpService: MercadoPublicoService,
    private readonly compraAgilService: CompraAgilService,
    private readonly tratoDirectoService: TratoDirectoService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Valida si un código cumple con la nomenclatura oficial de Mercado Público (ej: 2445-139-COT26, 2445-45-LP25)
   * o si es un UUID válido de Trato Directo. Omite cualquier marcador de posición o formato incorrecto.
   */
  public isValidCode(
    code: string | null | undefined,
    allowUuid = false,
  ): boolean {
    if (!code) return false;
    const clean = code.toString().trim().toUpperCase();

    const invalidKeywords = [
      'PENDIENTE',
      'NIC',
      'N/A',
      'NINGUNO',
      'SIN CODIGO',
      'S/C',
      'NULL',
      'UNDEFINED',
      'BORRADOR',
      'TEST',
    ];
    if (invalidKeywords.includes(clean) || clean.length < 5) {
      return false;
    }

    // Formato oficial de Mercado Público: DIGITOS-DIGITOS-LETRAS_Y_NUMEROS (ej: 2445-139-COT26, 2445-1933-TD26)
    const mpCodeRegex = /^\d{1,6}-\d{1,6}-[A-Z0-9]{2,6}$/;
    if (mpCodeRegex.test(clean)) {
      return true;
    }

    // UUIDs válidos (para fichas de Trato Directo V2)
    if (allowUuid) {
      const uuidRegex =
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
      if (uuidRegex.test(clean)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verifica si todas las fechas importadas relevantes de un registro ya pasaron.
   * Sirve para omitir re-sincronizaciones innecesarias en la API externa de Mercado Público.
   */
  public hasAllImportedDatesPassed(
    dates: (string | null | undefined)[],
  ): boolean {
    const validDates = dates
      .filter((d): d is string => !!d)
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()));

    if (validDates.length === 0) return false;

    const now = Date.now();
    const maxDate = Math.max(...validDates.map((d) => d.getTime()));
    return maxDate < now;
  }

  /**
   * Cron ejecutable 4 veces al día (08:00, 12:00, 16:00, 20:00) para actualizar
   * automáticamente todos los registros activos/en curso de Mercado Público.
   */
  @Cron('0 0 8,12,16,20 * * *')
  async handleCronSyncActive() {
    this.logger.log(
      '[SyncEngine] CRON (4x/día): Iniciando sincronización de procesos activos...',
    );
    try {
      const summary = await this.syncAllActive();
      this.logger.log(
        `[SyncEngine] CRON: Sincronización finalizada en ${summary.durationMs}ms. Licitaciones: ${summary.licitaciones.updated}/${summary.licitaciones.processed}, Compras Ágiles: ${summary.comprasAgiles.updated}/${summary.comprasAgiles.processed}, Tratos Directos: ${summary.tratosDirectos.updated}/${summary.tratosDirectos.processed}`,
      );
    } catch (err: any) {
      this.logger.error(`[SyncEngine] CRON error: ${err.message}`, err.stack);
    }
  }

  /**
   * Sincronización general de todos los módulos activos.
   */
  async syncAllActive(): Promise<SyncResultSummary> {
    if (this.isRunning) {
      this.logger.warn(
        '[SyncEngine] Ya hay un proceso de sincronización ejecutándose.',
      );
      const cachedStatus =
        (await this.cacheManager.get<SyncResultSummary>(
          'mp_last_sync_status',
        )) || this.buildEmptySummary();
      return cachedStatus;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const summary: SyncResultSummary = this.buildEmptySummary();

    try {
      // 1. Sincronizar Licitaciones
      summary.licitaciones = await this.syncLicitaciones();

      // 2. Sincronizar Compras Ágiles
      summary.comprasAgiles = await this.syncComprasAgiles();

      // 3. Sincronizar Tratos Directos
      summary.tratosDirectos = await this.syncTratosDirectos();

      // 4. Sincronizar Órdenes de Compra
      summary.ordenesCompra = await this.syncOrdenesCompra();
    } catch (err: any) {
      summary.lastError = err.message;
      this.logger.error(
        `[SyncEngine] Error general en syncAllActive: ${err.message}`,
      );
    } finally {
      summary.durationMs = Date.now() - startTime;
      summary.timestamp = new Date().toISOString();
      await this.cacheManager.set(
        'mp_last_sync_status',
        summary,
        24 * 60 * 60 * 1000,
      );
      this.isRunning = false;
    }

    return summary;
  }

  /**
   * Sincroniza todas las Licitaciones registradas en Supabase que se encuentren activas.
   * Utiliza la API oficial si el Ticket es válido, y recurre al Webhook interno como Fallback.
   */
  async syncLicitaciones(): Promise<{
    processed: number;
    updated: number;
    errors: number;
  }> {
    let processed = 0;
    let updated = 0;
    let errors = 0;

    try {
      const adminDb = this.supabaseService.getAdminClient();
      const { data: licitaciones, error: fetchErr } = await adminDb
        .from('licitaciones')
        .select('*')
        .eq('activo', true)
        .not('numero_licitacion', 'is', null);

      if (fetchErr || !licitaciones) {
        this.logger.error(
          `[SyncEngine] Error al obtener licitaciones: ${fetchErr?.message}`,
        );
        return { processed: 0, updated: 0, errors: 1 };
      }

      // Cargar listado del Webhook interno como fallback map
      const webhookMap = new Map<string, any>();
      try {
        const webhookData: any = await this.mpService.findAll();
        if (webhookData?.Listado && Array.isArray(webhookData.Listado)) {
          webhookData.Listado.forEach((item: any) => {
            const code = (item.CodigoExterno || item.id_licitacion || '')
              .toString()
              .toUpperCase()
              .trim();
            if (code) webhookMap.set(code, item);
          });
        }
      } catch (wErr: any) {
        this.logger.warn(
          `[SyncEngine] Webhook fallback map no disponible: ${wErr.message}`,
        );
      }

      for (const lic of licitaciones) {
        const cleanNum = (lic.numero_licitacion || '')
          .toString()
          .trim()
          .toUpperCase();

        // Omitir códigos de licitación incorrectos o fuera de la nomenclatura oficial
        if (!this.isValidCode(cleanNum)) {
          this.logger.debug(
            `[SyncEngine] Omitiendo licitación ID ${lic.id}: número '${cleanNum}' fuera de nomenclatura oficial.`,
          );
          continue;
        }

        // Omitir si todas las fechas de Mercado Público (cierre, servicio, adjudicación) ya pasaron
        const mpDates = [
          lic.mp_fecha_cierre,
          lic.fecha_cierre,
          lic.mp_fecha_final,
          lic.fecha_fin_servicio,
          lic.mp_fecha_estimada_adjudicacion,
          lic.mp_fecha_adjudicacion,
        ];
        if (this.hasAllImportedDatesPassed(mpDates)) {
          this.logger.debug(
            `[SyncEngine] Omitiendo licitación ${cleanNum}: sus fechas de Mercado Público ya transcurrieron.`,
          );
          continue;
        }

        processed++;
        let detail: any = null;

        // Intentar obtener detalle desde API oficial
        try {
          const detailRes = await this.mpService.findOne(cleanNum);
          detail =
            detailRes?.Listado && detailRes.Listado.length > 0
              ? detailRes.Listado[0]
              : detailRes;
        } catch {
          // Fallback al webhook interno si la API oficial falla por ticket o quota
          detail = webhookMap.get(cleanNum);
        }

        if (!detail) {
          errors++;
          this.logger.debug(
            `[SyncEngine] No se encontró información para licitación ${cleanNum} ni en API oficial ni en Webhook.`,
          );
          continue;
        }

        try {
          let estadoLocal = lic.estado;
          if (detail.CodigoEstado === 6 || detail.estado === 'Cerrada')
            estadoLocal = 'cerrada';
          else if (detail.CodigoEstado === 7 || detail.estado === 'Desierta')
            estadoLocal = 'desierta';
          else if (
            detail.CodigoEstado === 8 ||
            detail.estado === 'Adjudicada'
          )
            estadoLocal = 'adjudicada';
          else if (detail.CodigoEstado === 18 || detail.estado === 'Revocada')
            estadoLocal = 'revocada';
          else if (
            detail.CodigoEstado === 19 ||
            detail.estado === 'Suspendida'
          )
            estadoLocal = 'suspendida';
          else if (detail.CodigoEstado === 5 || detail.estado === 'Publicada')
            estadoLocal = 'abierta';

          const updateData: any = {
            titulo: detail.Nombre || detail.titulo || lic.titulo,
            entidad_emisora:
              detail.Comprador?.NombreOrganismo ||
              detail.comprador?.organismo ||
              lic.entidad_emisora,
            fecha_cierre:
              detail.Fechas?.FechaCierre ||
              detail.fechaCierre ||
              lic.fecha_cierre,
            fecha_publicacion:
              detail.Fechas?.FechaPublicacion ||
              detail.fechaPublicacion ||
              lic.fecha_publicacion,
            observaciones:
              detail.Descripcion || detail.descripcion || lic.observaciones,
            estado: estadoLocal,
            monto_estimado:
              detail.MontoEstimado ||
              detail.monto?.valor ||
              lic.monto_estimado,
            moneda: detail.Moneda || lic.moneda,
            codigo_estado_mp: detail.CodigoEstado || lic.codigo_estado_mp,
            dias_cierre_licitacion:
              detail.DiasCierreLicitacion || lic.dias_cierre_licitacion,
            comprador: detail.Comprador || detail.comprador || lic.comprador,
            items_mercadopublico: detail.Items || lic.items_mercadopublico,
            ultima_sincronizacion_mp: new Date().toISOString(),
          };

          if (detail.Fechas) {
            updateData.mp_fecha_creacion =
              detail.Fechas.FechaCreacion || lic.mp_fecha_creacion;
            updateData.mp_fecha_cierre =
              detail.Fechas.FechaCierre || lic.mp_fecha_cierre;
            updateData.mp_fecha_inicio =
              detail.Fechas.FechaInicio || lic.mp_fecha_inicio;
            updateData.mp_fecha_final =
              detail.Fechas.FechaFinal || lic.mp_fecha_final;
            updateData.mp_fecha_pub_respuestas =
              detail.Fechas.FechaPubRespuestas || lic.mp_fecha_pub_respuestas;
            updateData.mp_fecha_acto_apertura_tecnica =
              detail.Fechas.FechaActoAperturaTecnica ||
              lic.mp_fecha_acto_apertura_tecnica;
            updateData.mp_fecha_acto_apertura_economica =
              detail.Fechas.FechaActoAperturaEconomica ||
              lic.mp_fecha_acto_apertura_economica;
            updateData.mp_fecha_publicacion =
              detail.Fechas.FechaPublicacion || lic.mp_fecha_publicacion;
            updateData.mp_fecha_adjudicacion =
              detail.Fechas.FechaAdjudicacion || lic.mp_fecha_adjudicacion;
            updateData.mp_fecha_estimada_adjudicacion =
              detail.Fechas.FechaEstimadaAdjudicacion ||
              lic.mp_fecha_estimada_adjudicacion;
          }

          const { error: updateErr } = await adminDb
            .from('licitaciones')
            .update(updateData)
            .eq('id', lic.id);

          if (updateErr) {
            errors++;
            this.logger.error(
              `[SyncEngine] Error al actualizar licitación ${lic.id}: ${updateErr.message}`,
            );
          } else {
            updated++;
          }
        } catch (err: any) {
          errors++;
          this.logger.warn(
            `[SyncEngine] Error al procesar datos para licitación ${cleanNum}: ${err.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.error(`[SyncEngine] Fallo en syncLicitaciones: ${e.message}`);
    }

    return { processed, updated, errors };
  }

  /**
   * Sincroniza todas las Compras Ágiles registradas en Supabase.
   */
  async syncComprasAgiles(): Promise<{
    processed: number;
    updated: number;
    errors: number;
  }> {
    let processed = 0;
    let updated = 0;
    let errors = 0;

    try {
      const adminDb = this.supabaseService.getAdminClient();
      const { data: compras, error: fetchErr } = await adminDb
        .from('compras_agiles')
        .select('*')
        .eq('activo', true);

      if (fetchErr || !compras) {
        this.logger.error(
          `[SyncEngine] Error al obtener compras ágiles: ${fetchErr?.message}`,
        );
        return { processed: 0, updated: 0, errors: 1 };
      }

      for (const ca of compras) {
        if (!this.isValidCode(ca.codigo_compra_agil)) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Compra Ágil ID ${ca.id}: código '${ca.codigo_compra_agil}' fuera de nomenclatura oficial.`,
          );
          continue;
        }

        // Omitir si la fecha de cierre ya transcurrió en el pasado
        if (this.hasAllImportedDatesPassed([ca.fecha_cierre, ca.mp_fecha_cierre])) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Compra Ágil ${ca.codigo_compra_agil}: su fecha de cierre ya transcurrió.`,
          );
          continue;
        }

        processed++;

        try {
          await this.compraAgilService.syncByCode(
            ca.codigo_compra_agil,
            undefined,
            'auto_cron',
            ca.group_id ? String(ca.group_id) : undefined,
          );
          updated++;
        } catch (err: any) {
          errors++;
          if (
            err.status === 504 ||
            err.message?.includes('504') ||
            err.message?.includes('timeout')
          ) {
            this.logger.warn(
              `[SyncEngine] Compra Ágil ${ca.codigo_compra_agil} postergada: Servidor de Mercado Público sobrecargado (504 Gateway Timeout). Se reintentará en el próximo ciclo.`,
            );
          } else {
            this.logger.warn(
              `[SyncEngine] Error re-sincronizando Compra Ágil ${ca.codigo_compra_agil}: ${err.message}`,
            );
          }
        }
      }
    } catch (e: any) {
      this.logger.error(
        `[SyncEngine] Fallo en syncComprasAgiles: ${e.message}`,
      );
    }

    return { processed, updated, errors };
  }

  /**
   * Sincroniza todos los Tratos Directos registrados en Supabase.
   */
  async syncTratosDirectos(): Promise<{
    processed: number;
    updated: number;
    errors: number;
  }> {
    let processed = 0;
    let updated = 0;
    let errors = 0;

    try {
      const adminDb = this.supabaseService.getAdminClient();
      const { data: tratos, error: fetchErr } = await adminDb
        .from('tratos_directos')
        .select('*')
        .eq('activo', true);

      if (fetchErr || !tratos) {
        this.logger.error(
          `[SyncEngine] Error al obtener tratos directos: ${fetchErr?.message}`,
        );
        return { processed: 0, updated: 0, errors: 1 };
      }

      for (const td of tratos) {
        const idFicha = td.uuid_ficha || td.codigo_trato_directo;
        if (!this.isValidCode(idFicha, true)) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Trato Directo ID ${td.id}: código/UUID '${idFicha}' fuera de nomenclatura oficial.`,
          );
          continue;
        }

        // Omitir si las fechas del contrato o cierre ya pasaron
        if (this.hasAllImportedDatesPassed([td.fecha_cierre, td.fecha_termino_contrato])) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Trato Directo ${idFicha}: sus fechas del contrato ya transcurrieron.`,
          );
          continue;
        }

        processed++;

        try {
          await this.tratoDirectoService.syncByIdFicha(
            idFicha,
            undefined,
            td.group_id ? String(td.group_id) : undefined,
          );
          updated++;
        } catch (err: any) {
          errors++;
          if (err.status === 401 || err.message?.includes('401')) {
            this.logger.warn(
              `[SyncEngine] Token de Trato Directo caducado (401). Defina MERCADO_PUBLICO_TRATO_DIRECTO_TOKEN en .env con un token JWT válido.`,
            );
          } else {
            this.logger.warn(
              `[SyncEngine] Error re-sincronizando Trato Directo ${idFicha}: ${err.message}`,
            );
          }
        }
      }
    } catch (e: any) {
      this.logger.error(
        `[SyncEngine] Fallo en syncTratosDirectos: ${e.message}`,
      );
    }

    return { processed, updated, errors };
  }

  /**
   * Sincroniza las Órdenes de Compra registradas en Supabase.
   */
  async syncOrdenesCompra(): Promise<{
    processed: number;
    updated: number;
    errors: number;
  }> {
    let processed = 0;
    let updated = 0;
    let errors = 0;

    try {
      const adminDb = this.supabaseService.getAdminClient();
      const { data: ordenes, error: fetchErr } = await adminDb
        .from('ordenes_compra')
        .select('*')
        .not('codigo_oc', 'is', null);

      if (fetchErr || !ordenes) {
        this.logger.error(
          `[SyncEngine] Error al obtener ordenes de compra: ${fetchErr?.message}`,
        );
        return { processed: 0, updated: 0, errors: 1 };
      }

      for (const oc of ordenes) {
        if (!this.isValidCode(oc.codigo_oc)) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Orden de Compra ID ${oc.id}: código '${oc.codigo_oc}' fuera de nomenclatura oficial.`,
          );
          continue;
        }

        // Omitir si la OC ya concluyó en estado Aceptada/Cancelada/Rechazada o su fecha de aceptación ya pasó
        const ocFinalized = ['aceptada', 'cancelada', 'rechazada'].includes((oc.estado_mp || '').toLowerCase());
        if (ocFinalized || this.hasAllImportedDatesPassed([oc.fecha_aceptacion])) {
          this.logger.debug(
            `[SyncEngine] Omitiendo Orden de Compra ${oc.codigo_oc}: fecha de aceptación ya ocurrió o estado finalizado (${oc.estado_mp}).`,
          );
          continue;
        }
        processed++;

        try {
          const detailRes = await this.mpService.findOrdenCompra(oc.codigo_oc);
          const detail =
            detailRes?.Listado && detailRes.Listado.length > 0
              ? detailRes.Listado[0]
              : null;

          if (!detail) continue;

          const updateData: any = {
            proveedor_rut: detail.Proveedor?.RutSucursal || oc.proveedor_rut,
            proveedor_nombre: detail.Proveedor?.Nombre || oc.proveedor_nombre,
            comprador_nombre:
              detail.Comprador?.NombreOrganismo || oc.comprador_nombre,
            comprador_rut: detail.Comprador?.RutUnidad || oc.comprador_rut,
            estado_mp: detail.Estado || oc.estado_mp,
            monto_total: detail.Total
              ? parseFloat(detail.Total)
              : oc.monto_total,
            moneda: detail.TipoMoneda || oc.moneda,
            fecha_emision: detail.Fechas?.FechaCreacion || oc.fecha_emision,
            fecha_aceptacion:
              detail.Fechas?.FechaAceptacion || oc.fecha_aceptacion,
            datos_mp: detail,
            ultima_sincronizacion_mp: new Date().toISOString(),
          };

          const { error: updateErr } = await adminDb
            .from('ordenes_compra')
            .update(updateData)
            .eq('id', oc.id);

          if (updateErr) {
            errors++;
          } else {
            updated++;
          }
        } catch (err: any) {
          errors++;
          this.logger.debug(
            `[SyncEngine] No se pudo actualizar OC ${oc.codigo_oc} desde API oficial: ${err.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.error
        (`[SyncEngine] Fallo en syncOrdenesCompra: ${e.message}`);
    }

    return { processed, updated, errors };
  }

  /**
   * Obtiene la última información de estado de sincronización guardada en caché.
   */
  async getLastSyncStatus(): Promise<SyncResultSummary> {
    const cached = await this.cacheManager.get<SyncResultSummary>(
      'mp_last_sync_status',
    );
    return cached || this.buildEmptySummary();
  }

  private buildEmptySummary(): SyncResultSummary {
    return {
      timestamp: new Date().toISOString(),
      durationMs: 0,
      licitaciones: { processed: 0, updated: 0, errors: 0 },
      comprasAgiles: { processed: 0, updated: 0, errors: 0 },
      tratosDirectos: { processed: 0, updated: 0, errors: 0 },
      ordenesCompra: { processed: 0, updated: 0, errors: 0 },
      lastError: null,
    };
  }
}

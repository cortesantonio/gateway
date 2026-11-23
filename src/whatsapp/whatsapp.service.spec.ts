import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { throwError } from 'rxjs';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookGuard } from './guards/whatsapp-webhook.guard';
import { SupabaseService } from '../auth/supabase.service';

interface WhatsAppServiceInternals {
  normalizeChileanPhone(raw: string): string;
  parseConfirmationIntent(rawText: string): string | null;
}

describe('WhatsAppModule Audit & Edge Cases', () => {
  let service: WhatsAppService;
  let internals: WhatsAppServiceInternals;
  let guard: WhatsAppWebhookGuard;
  let mockHttpPost: jest.Mock;
  let mockConfigValues: Record<string, string | undefined>;
  let mockSupabaseClient: {
    from: jest.Mock;
    rpc: jest.Mock;
  };

  beforeEach(() => {
    mockConfigValues = {
      WHATSAPP_RECEIVE_TOKEN: 'secret-receive-token-123',
      WHATSAPP_EVOLUZIONA_SEND_TOKEN: 'secret-send-token-456',
    };

    const configService = {
      get: jest.fn((key: string) => mockConfigValues[key]),
    } as unknown as ConfigService;

    mockHttpPost = jest.fn();
    const httpService = {
      post: mockHttpPost,
    } as unknown as HttpService;

    mockSupabaseClient = {
      from: jest.fn(),
      rpc: jest.fn(),
    };

    const supabaseService = {
      getAdminClient: jest.fn(() => mockSupabaseClient),
    } as unknown as SupabaseService;

    service = new WhatsAppService(configService, httpService, supabaseService);
    internals = service as unknown as WhatsAppServiceInternals;
    guard = new WhatsAppWebhookGuard(configService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('WhatsAppWebhookGuard', () => {
    const createContext = (authHeader?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: authHeader ? { authorization: authHeader } : {},
          }),
        }),
      }) as never;

    it('rechaza peticiones sin Authorization header', () => {
      expect(() => guard.canActivate(createContext())).toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza tokens con distinta longitud o valor inválido', () => {
      expect(() => guard.canActivate(createContext('Bearer short'))).toThrow(
        UnauthorizedException,
      );
      expect(() =>
        guard.canActivate(createContext('Bearer secret-receive-token-999')),
      ).toThrow(UnauthorizedException);
    });

    it('acepta Bearer case-insensitive con el token exacto', () => {
      expect(
        guard.canActivate(createContext('bearer secret-receive-token-123')),
      ).toBe(true);
    });
  });

  describe('Normalización de teléfonos y validación de payloads', () => {
    it('normaliza formatos chilenos (09..., 9..., 8 dígitos, 5609...)', () => {
      expect(internals.normalizeChileanPhone('09 5700-0761')).toBe(
        '56957000761',
      );
      expect(internals.normalizeChileanPhone('957000761')).toBe('56957000761');
      expect(internals.normalizeChileanPhone('57000761')).toBe('56957000761');
      expect(internals.normalizeChileanPhone('+56 9 5700 0761')).toBe(
        '56957000761',
      );
      expect(internals.normalizeChileanPhone('560957000761')).toBe(
        '56957000761',
      );
    });

    it('rechaza eventos de webhook incompletos sin contaminar caché', async () => {
      await expect(
        service.processWebhookEvent({
          event: 'message.received',
          timestamp: '2026-11-11T10:00:00-03:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('valida media_url HTTPS y filename obligatorio para documentos', async () => {
      await expect(
        service.sendMessage({
          to: '56957000761',
          type: 'document',
          media_url: 'http://insecure.local/doc.pdf',
          filename: 'doc.pdf',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.sendMessage({
          to: '56957000761',
          type: 'document',
          media_url: 'https://saludcurico.cl/doc.pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Parser de intención de respuesta (parseConfirmationIntent)', () => {
    it('no confunde horarios ("1:30", "2:00") con confirmaciones o rechazos', () => {
      expect(internals.parseConfirmationIntent('1:30')).toBeNull();
      expect(internals.parseConfirmationIntent('2:00 pm')).toBeNull();
      expect(internals.parseConfirmationIntent('10 de noviembre')).toBeNull();
    });

    it('clasifica reprogramación antes de rechazo cuando dicen "no puedo, quiero cambiar la hora"', () => {
      expect(
        internals.parseConfirmationIntent(
          'No puedo ese día, quiero cambiar la hora',
        ),
      ).toBe('solicita_reprogramacion');
      expect(internals.parseConfirmationIntent('3')).toBe(
        'solicita_reprogramacion',
      );
    });

    it('clasifica rechazos y negaciones de confirmación antes que confirmación', () => {
      expect(internals.parseConfirmationIntent('No confirmo')).toBe(
        'rechazado',
      );
      expect(
        internals.parseConfirmationIntent('Ya no voy a poder asistir'),
      ).toBe('rechazado');
      expect(internals.parseConfirmationIntent('2.')).toBe('rechazado');
    });

    it('clasifica confirmaciones válidas', () => {
      expect(internals.parseConfirmationIntent('1')).toBe('confirmado');
      expect(internals.parseConfirmationIntent('1, confirmo')).toBe(
        'confirmado',
      );
      expect(internals.parseConfirmationIntent('Sí, ahí estaré 👍')).toBe(
        'confirmado',
      );
      expect(internals.parseConfirmationIntent('1ok')).toBe('confirmado');
      expect(internals.parseConfirmationIntent('1 si')).toBe('confirmado');
      expect(internals.parseConfirmationIntent('1 confirmo')).toBe(
        'confirmado',
      );
    });

    it('no confunde "1 no" ni "1 no puedo" con una confirmación (fix bug regex)', () => {
      // "1 no" seguido de negación no debe ser confirmado
      expect(internals.parseConfirmationIntent('1 no')).toBeNull();
      // "1 no puedo" -> el rechazo detecta "no puedo" antes
      expect(internals.parseConfirmationIntent('1 no puedo')).toBe('rechazado');
      // Números seguidos (11, 10, 21) no deben causar ninguna intención
      expect(internals.parseConfirmationIntent('11')).toBeNull();
      expect(internals.parseConfirmationIntent('10')).toBeNull();
      expect(internals.parseConfirmationIntent('21')).toBeNull();
    });
  });

  describe('Resiliencia ante eventos fuera de orden y fallback telefónico', () => {
    it('no degrada una cita ya confirmada/enviada cuando llega un failed tardío', async () => {
      const updateMock = jest.fn();
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'notificacion_cita') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: 1540,
                      estado_envio: 'enviado',
                      fecha_envio: '2026-11-11T12:00:00.000Z',
                      enviado_whatsapp: true,
                      estado_confirmacion: 'confirmado',
                    },
                    error: null,
                  }),
              }),
            }),
            update: updateMock,
          };
        }
        return {
          upsert: () => Promise.resolve({ error: null }),
        };
      });

      const res = await service.processWebhookEvent({
        event: 'message.status',
        request_id: 'cita-1540-abc123',
        message_id: 'msg-failed-old',
        status: 'failed',
        timestamp: '2026-11-11T11:55:00.000Z',
      });

      expect(res).toEqual({ ok: true });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('encuentra cita con teléfono con espacios/guiones y autocorrige estado_envio al recibir respuesta', async () => {
      const updatePayloads: Array<Record<string, unknown>> = [];
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'notificacion_cita') {
          const queryBuilder: any = {
            select: () => queryBuilder,
            eq: () => queryBuilder,
            gte: () => queryBuilder,
            lte: () => queryBuilder,
            ilike: () => queryBuilder,
            order: () => queryBuilder,
            limit: () => queryBuilder,
            returns: () =>
              Promise.resolve({
                data: [
                  {
                    id: 2050,
                    nombre_paciente: 'Juan Pérez',
                    telefono_paciente: '+56 9 5700-0761',
                    estado_confirmacion: 'pendiente',
                    estado_envio: 'en_cola',
                    fecha_envio: null,
                    enviado_whatsapp: true,
                    fecha_cita: '2026-11-20',
                    hora_cita: '10:00',
                  },
                ],
                error: null,
              }),
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              return {
                eq: () => Promise.resolve({ error: null }),
              };
            },
          };
          return queryBuilder;
        }
        return {
          upsert: () => Promise.resolve({ error: null }),
        };
      });

      const res = await service.processWebhookEvent({
        event: 'message.received',
        message_id: 'msg-in-2050',
        request_id: null,
        our_number: '56911111111',
        from: '56957000761',
        type: 'text',
        text: '1 confirmo',
        timestamp: '2026-11-11T13:00:00-03:00',
      });

      expect(res).toEqual({ ok: true });
      expect(updatePayloads).toHaveLength(1);
      expect(updatePayloads[0]).toMatchObject({
        estado_envio: 'enviado',
        enviado_whatsapp: true,
        estado_confirmacion: 'confirmado',
      });
    });

    it('bloquea el envío si la cita está en estado no_responde o reasignado', async () => {
      mockSupabaseClient.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 3010,
                    nombre_paciente: 'Ana Gómez',
                    telefono_paciente: '56957000761',
                    estado_envio: 'enviado',
                    estado_confirmacion: 'no_responde',
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }));

      await expect(
        service.sendMessage({ notificationId: 3010 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('no sobrescribe estado_confirmacion si el paciente cita un mensaje de una cita expirada (no_responde)', async () => {
      const updatePayloads: Array<Record<string, unknown>> = [];
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'notificacion_cita') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 3010,
                        nombre_paciente: 'Ana Gómez',
                        telefono_paciente: '56957000761',
                        estado_confirmacion: 'no_responde',
                        estado_envio: 'enviado',
                        fecha_envio: '2026-11-10T10:00:00.000Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              return {
                eq: () => Promise.resolve({ error: null }),
              };
            },
          };
        }
        return {
          upsert: () => Promise.resolve({ error: null }),
        };
      });

      const res = await service.processWebhookEvent({
        event: 'message.received',
        message_id: 'msg-in-3010',
        request_id: 'cita-3010-abc123',
        our_number: '56911111111',
        from: '56957000761',
        type: 'text',
        text: '1 confirmo',
        timestamp: '2026-11-12T08:00:00-03:00',
      });

      expect(res).toEqual({ ok: true });
      expect(updatePayloads).toHaveLength(0);
    });
  });

  describe('Salud del servicio y cuotas diarias por grupo', () => {
    it('getHealthStatus responde ok si está configurado y 503 si falta token', () => {
      expect(service.getHealthStatus()).toMatchObject({
        status: 'ok',
        service: 'whatsapp-webhook-receiver',
      });

      const originalEnv = process.env.WHATSAPP_EVOLUZIONA_SEND_TOKEN;
      delete process.env.WHATSAPP_EVOLUZIONA_SEND_TOKEN;
      mockConfigValues.WHATSAPP_EVOLUZIONA_SEND_TOKEN = undefined;

      try {
        expect(() => service.getHealthStatus()).toThrow(
          ServiceUnavailableException,
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.WHATSAPP_EVOLUZIONA_SEND_TOKEN = originalEnv;
        }
      }
    });

    it('getGroupQuota reinicia visualmente el consumo cuando la fecha registrada es de un día anterior', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'groups') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: 'grp-1',
                      unidad: 'SOME Curicó',
                      whatsapp_daily_limit: 50,
                      whatsapp_daily_usage: 48,
                      whatsapp_usage_date: '2020-01-01',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {};
      });

      const quota = await service.getGroupQuota('grp-1');
      expect(quota.dailyLimit).toBe(50);
      expect(quota.dailyUsage).toBe(0);
      expect(quota.remaining).toBe(50);
      expect(quota.exhausted).toBe(false);
    });

    it('rechaza con 429 sin llamar a Evoluziona cuando el grupo agotó su cuota diaria', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'notificacion_cita') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 4001,
                        group_id: 'grp-1',
                        nombre_paciente: 'Carlos Ruiz',
                        telefono_paciente: '56957000761',
                        estado_envio: 'pendiente',
                        estado_confirmacion: 'pendiente',
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseClient.rpc.mockResolvedValue({
        data: {
          allowed: false,
          not_found: false,
          group_id: 'grp-1',
          group_name: 'SOME Curicó',
          daily_limit: 20,
          daily_usage: 20,
          remaining: 0,
          usage_date: '2026-11-12',
        },
        error: null,
      });

      let caught: unknown;
      try {
        await service.sendMessage({ notificationId: 4001 });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(mockHttpPost).not.toHaveBeenCalled();
    });

    it('reembolsa el cupo del grupo si falla la llamada al proveedor Evoluziona', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'notificacion_cita') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 4002,
                        group_id: 'grp-1',
                        nombre_paciente: 'María López',
                        telefono_paciente: '56957000761',
                        estado_envio: 'pendiente',
                        estado_confirmacion: 'pendiente',
                      },
                      error: null,
                    }),
                }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        return {};
      });

      mockSupabaseClient.rpc
        .mockResolvedValueOnce({
          data: {
            allowed: true,
            not_found: false,
            group_id: 'grp-1',
            group_name: 'SOME Curicó',
            daily_limit: 20,
            daily_usage: 5,
            remaining: 15,
            usage_date: '2026-11-12',
          },
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null });

      mockHttpPost.mockReturnValue(
        throwError(() => new Error('Timeout de red Evoluziona')),
      );

      await expect(
        service.sendMessage({ notificationId: 4002 }),
      ).rejects.toThrow();

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'consume_whatsapp_group_quota',
        { p_group_id: 'grp-1', p_count: 1 },
      );
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'refund_whatsapp_group_quota',
        { p_group_id: 'grp-1', p_count: 1 },
      );
    });
  });
});

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class WhatsAppWebhookGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppWebhookGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    const expectedToken =
      this.configService.get<string>('WHATSAPP_RECEIVE_TOKEN') ||
      process.env.WHATSAPP_RECEIVE_TOKEN;

    if (!expectedToken) {
      this.logger.error(
        'WHATSAPP_RECEIVE_TOKEN no está configurado en las variables de entorno.',
      );
      throw new UnauthorizedException('Token de recepción no configurado');
    }

    if (!authHeader || typeof authHeader !== 'string') {
      this.logger.warn('Webhook recibido sin encabezado Authorization');
      throw new UnauthorizedException('Encabezado de autorización ausente');
    }

    const match = /^bearer\s+(.+)$/i.exec(authHeader.trim());
    const token = match ? match[1].trim() : '';

    if (!token || !this.safeTokenEquals(token, expectedToken)) {
      this.logger.warn(
        `Token de recepción inválido. Recibido: ${token ? token.substring(0, 6) + '...' : 'vacío'}`,
      );
      throw new UnauthorizedException('Token de recepción inválido');
    }

    return true;
  }

  /**
   * Comparación en tiempo constante usando digest SHA-256 para evitar timing attacks
   * y no filtrar la longitud del token esperado.
   */
  private safeTokenEquals(received: string, expected: string): boolean {
    const hashA = createHash('sha256').update(received, 'utf8').digest();
    const hashB = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(hashA, hashB);
  }
}

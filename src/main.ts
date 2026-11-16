import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import * as fs from 'fs';
import * as path from 'path';
import helmet from 'helmet';
import { json, urlencoded } from 'express'; // <--- Importante

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Límite reducido (64kb) para el webhook de WhatsApp — un payload de Evoluziona
  // nunca debería superar unos pocos KB; el límite global de 50mb queda para
  // los demás endpoints (subida de archivos, mass-mail, etc.).
  app.use('/whatsapp/webhook', json({ limit: '64kb' }));
  app.use('/whatsapp/webhook', urlencoded({ extended: false, limit: '64kb' }));

  // Body parser global para el resto de rutas
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // 🔑 Configuración CORS mejorada 🔑
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Añadimos OPTIONS
    // Lista más robusta de encabezados permitidos para peticiones fetch/axios
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ],
    credentials: true, // Si usas cookies o sesiones
  });
  // Seguridad y Fingerprinting
  app.use(helmet());
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();

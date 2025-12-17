import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import * as fs from 'fs';
import * as path from 'path';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 🔑 Configuración CORS mejorada 🔑
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Añadimos OPTIONS
    // Lista más robusta de encabezados permitidos para peticiones fetch/axios
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'], 
    credentials: true, // Si usas cookies o sesiones
  });
// Seguridad y Fingerprinting
  app.use(helmet());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();

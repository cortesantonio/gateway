import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { MercadoPublicoService } from './mercadopublico.service';
import { MercadoPublicoSyncService } from './mercadopublico-sync.service';
import { MercadoPublicoController } from './mercadopublico.controller';
import { CompraAgilService } from './compra-agil.service';
import { CompraAgilController } from './compra-agil.controller';
import { TratoDirectoService } from './trato-directo.service';
import { TratoDirectoController } from './trato-directo.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    HttpModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: await redisStore({
          socket: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
          },
          password: configService.get('REDIS_PASSWORD'),
          ttl: 30 * 60 * 1000, // 30 minutos (en ms para redis-yet)
        }),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    MercadoPublicoController,
    CompraAgilController,
    TratoDirectoController,
  ],
  providers: [
    MercadoPublicoService,
    MercadoPublicoSyncService,
    CompraAgilService,
    TratoDirectoService,
  ],
  exports: [
    MercadoPublicoService,
    MercadoPublicoSyncService,
    CompraAgilService,
    TratoDirectoService,
  ],
})
export class MercadoPublicoModule {}

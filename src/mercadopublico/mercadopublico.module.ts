import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { MercadoPublicoService } from './mercadopublico.service';
import { MercadoPublicoController } from './mercadopublico.controller';

@Module({
  imports: [
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
  controllers: [MercadoPublicoController],
  providers: [MercadoPublicoService],
  exports: [MercadoPublicoService],
})
export class MercadoPublicoModule {}

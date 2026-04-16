import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: await redisStore({
          socket: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
          },
          password: configService.get('REDIS_PASSWORD'),
        }),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}

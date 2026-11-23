import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';

@Module({
  imports: [HttpModule, ConfigModule, AuthModule],
  controllers: [ZoomController],
  providers: [ZoomService],
  exports: [ZoomService],
})
export class ZoomModule {}

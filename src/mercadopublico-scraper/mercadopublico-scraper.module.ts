import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MercadoPublicoScraperService } from './mercadopublico-scraper.service';
import { MercadoPublicoScraperController } from './mercadopublico-scraper.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, HttpModule],
  controllers: [MercadoPublicoScraperController],
  providers: [MercadoPublicoScraperService],
  exports: [MercadoPublicoScraperService],
})
export class MercadoPublicoScraperModule {}

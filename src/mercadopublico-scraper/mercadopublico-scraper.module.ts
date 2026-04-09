import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MercadoPublicoScraperService } from './mercadopublico-scraper.service';
import { MercadoPublicoScraperController } from './mercadopublico-scraper.controller';

@Module({
  imports: [HttpModule],
  controllers: [MercadoPublicoScraperController],
  providers: [MercadoPublicoScraperService],
  exports: [MercadoPublicoScraperService],
})
export class MercadoPublicoScraperModule {}

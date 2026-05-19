import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MassMailService } from './mass-mail.service';
import { SendMassMailDto } from './dto/send-mass-mail.dto';

@Controller('mass-mail')
export class MassMailController {
  constructor(private readonly massMailService: MassMailService) {}

  @Post('enqueue')
  async enqueue(@Body() dto: SendMassMailDto) {
    return await this.massMailService.enqueueEmails(dto);
  }

  @SkipThrottle()
  @Get('history')
  async getHistory(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return await this.massMailService.getHistory(page, limit);
  }

  @SkipThrottle()
  @Get('stats')
  async getStats() {
    return await this.massMailService.getQueueStats();
  }
}

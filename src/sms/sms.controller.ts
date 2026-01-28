import { Controller, Post, Body } from '@nestjs/common';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
    constructor(private readonly smsService: SmsService) { }

    @Post('send')
    async sendSms(@Body('number') number: string, @Body('message') message: string) {
        return this.smsService.sendSms(number, message);
    }
}

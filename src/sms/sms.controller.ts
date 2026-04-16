import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SendSmsJobData, SMS_QUEUE_NAME, SEND_SMS_JOB_NAME } from './sms.types';
import { SmsService } from './sms.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('sms')
@UseGuards(SupabaseAuthGuard)
export class SmsController {
    constructor(
        @InjectQueue(SMS_QUEUE_NAME) private smsQueue: Queue<SendSmsJobData>,
        private smsService: SmsService
    ) { }

    @Post('send')
    async sendSms(@Body('number') number: string, @Body('message') message: string) {
        // Agregar job a la cola
        const job = await this.smsQueue.add(SEND_SMS_JOB_NAME, {
            number,
            message,
        }, {
            attempts: 3, // Reintentar hasta 3 veces en caso de fallo
            backoff: {
                type: 'exponential',
                delay: 2000, // Empezar con 2 segundos, luego 4, luego 8
            },
            removeOnComplete: 100, // Mantener últimos 100 jobs completados
            removeOnFail: 200, // Mantener últimos 200 jobs fallidos
        });

        return {
            success: true,
            message: 'SMS agregado a la cola',
            jobId: job.id,
        };
    }
    @Get('CheckAnswer')
    async CheckAnswer() {
        const rawOutput = await this.smsService.CheckAnswer();
        return this.smsService.parseSmsOutput(rawOutput);
    }

}

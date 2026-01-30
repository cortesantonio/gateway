import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SmsService } from './sms.service';
import { SendSmsJobData, SMS_QUEUE_NAME, SEND_SMS_JOB_NAME } from './sms.types';

@Processor(SMS_QUEUE_NAME, {
    concurrency: 1, // Procesar 1 SMS a la vez (porque usa un solo dispositivo Android)
})
export class SmsProcessor extends WorkerHost {
    private readonly logger = new Logger(SmsProcessor.name);

    constructor(private readonly smsService: SmsService) {
        super();
    }

    async process(job: Job<SendSmsJobData>): Promise<void> {
        this.logger.log(`Processing SMS job ${job.id} for number ${job.data.number}`);

        try {
            await this.smsService.sendSms(job.data.number, job.data.message);
            this.logger.log(`SMS job ${job.id} completed successfully`);
        } catch (error) {
            this.logger.error(`SMS job ${job.id} failed: ${error.message}`, error.stack);
            throw error; // Re-throw para que BullMQ pueda manejar el reintento
        }
    }
}

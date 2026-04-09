import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SmsService } from './sms.service';
import { SendSmsJobData } from './sms.types';
export declare class SmsProcessor extends WorkerHost {
    private readonly smsService;
    private readonly logger;
    constructor(smsService: SmsService);
    process(job: Job<SendSmsJobData>): Promise<void>;
}

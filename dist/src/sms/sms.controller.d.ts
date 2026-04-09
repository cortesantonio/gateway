import { Queue } from 'bullmq';
import { SendSmsJobData } from './sms.types';
import { SmsService } from './sms.service';
export declare class SmsController {
    private smsQueue;
    private smsService;
    constructor(smsQueue: Queue<SendSmsJobData>, smsService: SmsService);
    sendSms(number: string, message: string): Promise<{
        success: boolean;
        message: string;
        jobId: string | undefined;
    }>;
    CheckAnswer(): Promise<{
        id: number | null;
        row: number | null;
        address: string | null;
        body: string | null;
        type: number | null;
        date: number | null;
    }[]>;
}

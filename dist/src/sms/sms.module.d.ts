import { OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
export declare class SmsModule implements OnModuleInit {
    private readonly smsQueue;
    constructor(smsQueue: Queue);
    onModuleInit(): Promise<void>;
}

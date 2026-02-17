import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuthModule } from '../auth/auth.module';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SmsProcessor } from './sms.processor';
import { SMS_QUEUE_NAME, CHECK_SMS_ANSWERS_JOB_NAME } from './sms.types';

@Module({
    imports: [
        BullModule.registerQueue({
            name: SMS_QUEUE_NAME,
        }),
        AuthModule,
    ],
    controllers: [SmsController],
    providers: [SmsService, SmsProcessor],
    exports: [SmsService],
})
export class SmsModule implements OnModuleInit {
    constructor(@InjectQueue(SMS_QUEUE_NAME) private readonly smsQueue: Queue) { }

    async onModuleInit() {
        // Registrar tarea recurrente cada 5 minutos
        await this.smsQueue.add(
            CHECK_SMS_ANSWERS_JOB_NAME,
            {},
            {
                repeat: {
                    pattern: '*/5 * * * *', // Cada 5 minutos
                },
                removeOnComplete: true,
                removeOnFail: true,
            },
        );
    }
}

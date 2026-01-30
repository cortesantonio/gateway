import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SmsProcessor } from './sms.processor';
import { SMS_QUEUE_NAME } from './sms.types';

@Module({
    imports: [
        BullModule.registerQueue({
            name: SMS_QUEUE_NAME,
        }),
    ],
    controllers: [SmsController],
    providers: [SmsService, SmsProcessor],
    exports: [SmsService],
})
export class SmsModule { }

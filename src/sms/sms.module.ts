import { Module, OnModuleInit, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SmsModule.name);

  constructor(@InjectQueue(SMS_QUEUE_NAME) private readonly smsQueue: Queue) {}

  async onModuleInit() {
    // Solo registrar la tarea recurrente si ENABLE_SMS_PROCESSING está habilitado
    const enableSms = process.env.ENABLE_SMS_PROCESSING;
    if (enableSms !== 'true') {
      this.logger.warn(
        'SMS processing is DISABLED. Set ENABLE_SMS_PROCESSING=true in .env to enable.',
      );
      return;
    }

    this.logger.log(
      'SMS processing is ENABLED. Registering periodic check-answers job...',
    );
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

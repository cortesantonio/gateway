import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MassMailController } from './mass-mail.controller';
import { MassMailService } from './mass-mail.service';
import { MassMailProcessor } from './mass-mail.processor';
import { BounceCheckerService } from './bounce-checker.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'mass-mail-queue',
        }),
        MailModule,
        AuthModule,
    ],
    controllers: [MassMailController],
    providers: [MassMailService, MassMailProcessor, BounceCheckerService],
    exports: [MassMailService],
})
export class MassMailModule { }


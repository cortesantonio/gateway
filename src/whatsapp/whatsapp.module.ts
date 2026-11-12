import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookGuard } from './guards/whatsapp-webhook.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    AuthModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppWebhookGuard],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}

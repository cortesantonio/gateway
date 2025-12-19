import { Module } from '@nestjs/common';
import { FilesModule } from './files/files.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MailModule } from './mail/mail.module';

@Module({
    imports: [
        MailModule,
        FilesModule,
        AuthModule,
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        ThrottlerModule.forRoot([
            {
                ttl: 60000, // 1 minuto
                limit: 100, // 100 requests por minuto
            },
        ]),
    ],
    controllers: [],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule { }

import { Controller, Post, Body, HttpStatus, HttpCode, BadRequestException } from '@nestjs/common';
import { MailService } from './mail.service';

interface MailBody {
    to: string;
    bcc?: string;
    subject: string;
    html?: string;
    text?: string;
    template?: {
        title: string;
        subtitle?: string;
        message: string;
        actionUrl?: string;
        actionText?: string;
        details?: string;
        actionInstruction?: string;
    };
}

@Controller('mail')
export class MailController {
    constructor(private readonly mailService: MailService) { }

    @Post('send')
    @HttpCode(HttpStatus.OK)
    async sendMail(@Body() body: MailBody) {
        if (!body || (!body.to && !body.bcc) || !body.subject) {
            throw new BadRequestException('Faltan campos requeridos: "subject" y al menos uno entre "to" o "bcc".');
        }

        let htmlContent = body.html;

        // Si se proporciona un objeto template, usamos el generador de plantillas
        if (body.template) {
            htmlContent = this.mailService.getBasicTemplate(
                body.template.title,
                body.template.subtitle || '',
                body.template.message,
                body.template.actionUrl,
                body.template.actionText,
                body.template.details,
                body.template.actionInstruction
            );
        }

        if (!htmlContent) {
            throw new BadRequestException('Debes proporcionar "html" o un objeto "template" con el contenido del correo.');
        }

        const info = await this.mailService.sendMail(body.to, body.subject, htmlContent, body.text, body.bcc);

        return {
            success: true,
            message: 'Email enviado correctamente',
            messageId: info.messageId,
        };
    }
}

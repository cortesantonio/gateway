import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(MailService.name);

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: 465,
            secure: true, // OBLIGATORIO
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false,
            },
        });

        this.verifyConnection();
    }

    async verifyConnection() {
        try {
            await this.transporter.verify();
            this.logger.log('Mail server connection established successfully');
        } catch (error) {
            this.logger.error('Error connecting to mail server', error);
        }
    }

    async sendMail(to: string, subject: string, html: string, text?: string, bcc?: string) {
        try {
            const path = require('path');
            const logoPath = path.join(process.cwd(), 'src', 'img', 'logo-muni.jpg');

            const info = await this.transporter.sendMail({
                from: process.env.MAIL_FROM || process.env.MAIL_USER,
                to,
                bcc,
                subject,
                html,
                text: text || html.replace(/<[^>]*>?/gm, ''), // Fallback simple strip tags if no text provided
                attachments: [
                    {
                        filename: 'logo-muni.jpg',
                        path: logoPath,
                        cid: 'logo-muni'
                    }
                ]
            });
            this.logger.log(`Email sent: ${info.messageId}`);
            return info;
        } catch (error) {
            this.logger.error(`Error sending email to ${to}`, error);
            throw error;
        }
    }

    getBasicTemplate(title: string, subtitle: string, message: string, actionUrl?: string, actionText?: string, detailsHtml?: string, actionInstruction?: string): string {
        return `
<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>

<body
    style="margin: 0; padding: 0; background-color: #e6e6e6ff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333333;">
    <center>
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600"
            style="background-color: #ffffff; margin-top: 20px; margin-bottom: 20px;">
            <tr>
                <td align="left" style="padding: 0;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                            <td width="100" bgcolor="#219542" style="padding: 15px; text-align: center;">
                                <img src="cid:logo-muni" alt="Logo"
                                    width="60" style="display: block; margin: 0 auto;">
                            </td>
                            <td></td>
                        </tr>
                    </table>
                </td>
            </tr>

            <tr>
                <td style="padding: 30px 40px;">
                    <h1 style="font-size: 24px; margin: 0 0 10px 0; font-weight: bold; color: #000000;">${title}</h1>
                    <p style="font-size: 14px; line-height: 1.4; color: #000; margin-bottom: 20px;">
                        ${message.replace(/\n/g, '<br>')}
                    </p>

                    ${detailsHtml ? detailsHtml : ''}

                    ${actionInstruction ? `<p style="font-size: 14px; color: #555555; margin-top: 20px; margin-bottom: 15px;">
                        ${actionInstruction}
                    </p>` : ''}

                    ${actionUrl && actionText ? `<table border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                            <td>
                                <a href="${actionUrl}"
                                    style="background-color: #219542; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 30px; font-weight: bold; font-size: 12px; letter-spacing: 1px; display: inline-block;">${actionText}</a>
                            </td>
                        </tr>
                    </table>` : ''}
                </td>
            </tr>
        </table>

        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600"
            style="margin-bottom: 20px; text-align: center; color: #888888;">
            <tr>
                <td style="font-size: 11px; line-height: 1.6;">
                    Direccion Comunal de Salud, Carmen 925, Curicó, Maule.<br>
                </td>
            </tr>
            <tr>
                <td>
                    <p style="color:#aaaaaa; font-size: 11px; margin-bottom: 5px;">Mensaje generado automaticamente.</p>
                </td>
            </tr>
        </table>
    </center>
</body>

</html>
        `;
    }
}

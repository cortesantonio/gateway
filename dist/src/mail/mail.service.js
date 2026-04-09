"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const nodemailer = __importStar(require("nodemailer"));
let MailService = MailService_1 = class MailService {
    transporter;
    logger = new common_1.Logger(MailService_1.name);
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: 465,
            secure: true,
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
        }
        catch (error) {
            this.logger.error('Error connecting to mail server', error);
        }
    }
    async sendMail(to, subject, html, text, bcc, attachments) {
        try {
            const path = require('path');
            const logoPath = path.join(process.cwd(), 'src', 'img', 'logo-muni.jpg');
            const defaultAttachments = [
                {
                    filename: 'logo-muni.jpg',
                    path: logoPath,
                    cid: 'logo-muni'
                }
            ];
            const finalAttachments = attachments ? [...defaultAttachments, ...attachments] : defaultAttachments;
            const info = await this.transporter.sendMail({
                from: process.env.MAIL_FROM || process.env.MAIL_USER,
                to,
                bcc,
                subject,
                html,
                text: text || html.replace(/<[^>]*>?/gm, ''),
                attachments: finalAttachments
            });
            this.logger.log(`Email sent: ${info.messageId}`);
            return info;
        }
        catch (error) {
            this.logger.error(`Error sending email to ${to}`, error);
            throw error;
        }
    }
    getBasicTemplate(title, subtitle, message, actionUrl, actionText, detailsHtml, actionInstruction) {
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
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], MailService);
//# sourceMappingURL=mail.service.js.map
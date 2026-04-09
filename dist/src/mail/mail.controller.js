"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailController = void 0;
const common_1 = require("@nestjs/common");
const mail_service_1 = require("./mail.service");
let MailController = class MailController {
    mailService;
    constructor(mailService) {
        this.mailService = mailService;
    }
    async sendMail(body) {
        if (!body || (!body.to && !body.bcc) || !body.subject) {
            throw new common_1.BadRequestException('Faltan campos requeridos: "subject" y al menos uno entre "to" o "bcc".');
        }
        let htmlContent = body.html;
        if (body.template) {
            htmlContent = this.mailService.getBasicTemplate(body.template.title, body.template.subtitle || '', body.template.message, body.template.actionUrl, body.template.actionText, body.template.details, body.template.actionInstruction);
        }
        if (!htmlContent) {
            throw new common_1.BadRequestException('Debes proporcionar "html" o un objeto "template" con el contenido del correo.');
        }
        const info = await this.mailService.sendMail(body.to, body.subject, htmlContent, body.text, body.bcc, body.attachments);
        return {
            success: true,
            message: 'Email enviado correctamente',
            messageId: info.messageId,
        };
    }
};
exports.MailController = MailController;
__decorate([
    (0, common_1.Post)('send'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "sendMail", null);
exports.MailController = MailController = __decorate([
    (0, common_1.Controller)('mail'),
    __metadata("design:paramtypes", [mail_service_1.MailService])
], MailController);
//# sourceMappingURL=mail.controller.js.map
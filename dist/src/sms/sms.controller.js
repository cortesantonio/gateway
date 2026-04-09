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
exports.SmsController = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const sms_types_1 = require("./sms.types");
const sms_service_1 = require("./sms.service");
let SmsController = class SmsController {
    smsQueue;
    smsService;
    constructor(smsQueue, smsService) {
        this.smsQueue = smsQueue;
        this.smsService = smsService;
    }
    async sendSms(number, message) {
        const job = await this.smsQueue.add(sms_types_1.SEND_SMS_JOB_NAME, {
            number,
            message,
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
            removeOnComplete: 100,
            removeOnFail: 200,
        });
        return {
            success: true,
            message: 'SMS agregado a la cola',
            jobId: job.id,
        };
    }
    async CheckAnswer() {
        const rawOutput = await this.smsService.CheckAnswer();
        return this.smsService.parseSmsOutput(rawOutput);
    }
};
exports.SmsController = SmsController;
__decorate([
    (0, common_1.Post)('send'),
    __param(0, (0, common_1.Body)('number')),
    __param(1, (0, common_1.Body)('message')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SmsController.prototype, "sendSms", null);
__decorate([
    (0, common_1.Get)('CheckAnswer'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SmsController.prototype, "CheckAnswer", null);
exports.SmsController = SmsController = __decorate([
    (0, common_1.Controller)('sms'),
    __param(0, (0, bullmq_1.InjectQueue)(sms_types_1.SMS_QUEUE_NAME)),
    __metadata("design:paramtypes", [bullmq_2.Queue,
        sms_service_1.SmsService])
], SmsController);
//# sourceMappingURL=sms.controller.js.map
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
var SmsProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const sms_service_1 = require("./sms.service");
const sms_types_1 = require("./sms.types");
let SmsProcessor = SmsProcessor_1 = class SmsProcessor extends bullmq_1.WorkerHost {
    smsService;
    logger = new common_1.Logger(SmsProcessor_1.name);
    constructor(smsService) {
        super();
        this.smsService = smsService;
    }
    async process(job) {
        if (job.name === sms_types_1.SEND_SMS_JOB_NAME) {
            this.logger.log(`Processing SMS job ${job.id} for number ${job.data.number}`);
            try {
                await this.smsService.sendSms(job.data.number, job.data.message);
                this.logger.log(`SMS job ${job.id} completed successfully`);
            }
            catch (error) {
                this.logger.error(`SMS job ${job.id} failed: ${error.message}`, error.stack);
                throw error;
            }
        }
        else if (job.name === sms_types_1.CHECK_SMS_ANSWERS_JOB_NAME) {
            this.logger.log(`Periodic check: processing SMS answers from ADB`);
            try {
                await this.smsService.processSmsAnswers();
            }
            catch (error) {
                this.logger.error(`Periodic SMS check failed: ${error.message}`, error.stack);
                throw error;
            }
        }
    }
};
exports.SmsProcessor = SmsProcessor;
exports.SmsProcessor = SmsProcessor = SmsProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(sms_types_1.SMS_QUEUE_NAME, {
        concurrency: 1,
    }),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], SmsProcessor);
//# sourceMappingURL=sms.processor.js.map
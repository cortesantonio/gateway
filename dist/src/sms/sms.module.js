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
exports.SmsModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const auth_module_1 = require("../auth/auth.module");
const sms_service_1 = require("./sms.service");
const sms_controller_1 = require("./sms.controller");
const sms_processor_1 = require("./sms.processor");
const sms_types_1 = require("./sms.types");
let SmsModule = class SmsModule {
    smsQueue;
    constructor(smsQueue) {
        this.smsQueue = smsQueue;
    }
    async onModuleInit() {
        await this.smsQueue.add(sms_types_1.CHECK_SMS_ANSWERS_JOB_NAME, {}, {
            repeat: {
                pattern: '*/5 * * * *',
            },
            removeOnComplete: true,
            removeOnFail: true,
        });
    }
};
exports.SmsModule = SmsModule;
exports.SmsModule = SmsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({
                name: sms_types_1.SMS_QUEUE_NAME,
            }),
            auth_module_1.AuthModule,
        ],
        controllers: [sms_controller_1.SmsController],
        providers: [sms_service_1.SmsService, sms_processor_1.SmsProcessor],
        exports: [sms_service_1.SmsService],
    }),
    __param(0, (0, bullmq_1.InjectQueue)(sms_types_1.SMS_QUEUE_NAME)),
    __metadata("design:paramtypes", [bullmq_2.Queue])
], SmsModule);
//# sourceMappingURL=sms.module.js.map
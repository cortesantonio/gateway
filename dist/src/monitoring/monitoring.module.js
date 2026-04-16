"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringModule = void 0;
const common_1 = require("@nestjs/common");
const cache_manager_1 = require("@nestjs/cache-manager");
const config_1 = require("@nestjs/config");
const cache_manager_redis_yet_1 = require("cache-manager-redis-yet");
const monitoring_controller_1 = require("./monitoring.controller");
const monitoring_service_1 = require("./monitoring.service");
const auth_module_1 = require("../auth/auth.module");
let MonitoringModule = class MonitoringModule {
};
exports.MonitoringModule = MonitoringModule;
exports.MonitoringModule = MonitoringModule = __decorate([
    (0, common_1.Module)({
        imports: [
            auth_module_1.AuthModule,
            cache_manager_1.CacheModule.registerAsync({
                imports: [config_1.ConfigModule],
                useFactory: async (configService) => ({
                    store: await (0, cache_manager_redis_yet_1.redisStore)({
                        socket: {
                            host: configService.get('REDIS_HOST', 'localhost'),
                            port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
                        },
                        password: configService.get('REDIS_PASSWORD'),
                    }),
                }),
                inject: [config_1.ConfigService],
            }),
        ],
        controllers: [monitoring_controller_1.MonitoringController],
        providers: [monitoring_service_1.MonitoringService],
    })
], MonitoringModule);
//# sourceMappingURL=monitoring.module.js.map
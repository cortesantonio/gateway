"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPublicoScraperModule = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const mercadopublico_scraper_service_1 = require("./mercadopublico-scraper.service");
const mercadopublico_scraper_controller_1 = require("./mercadopublico-scraper.controller");
const auth_module_1 = require("../auth/auth.module");
let MercadoPublicoScraperModule = class MercadoPublicoScraperModule {
};
exports.MercadoPublicoScraperModule = MercadoPublicoScraperModule;
exports.MercadoPublicoScraperModule = MercadoPublicoScraperModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, axios_1.HttpModule],
        controllers: [mercadopublico_scraper_controller_1.MercadoPublicoScraperController],
        providers: [mercadopublico_scraper_service_1.MercadoPublicoScraperService],
        exports: [mercadopublico_scraper_service_1.MercadoPublicoScraperService],
    })
], MercadoPublicoScraperModule);
//# sourceMappingURL=mercadopublico-scraper.module.js.map
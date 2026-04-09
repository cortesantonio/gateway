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
exports.MercadoPublicoScraperController = void 0;
const common_1 = require("@nestjs/common");
const mercadopublico_scraper_service_1 = require("./mercadopublico-scraper.service");
let MercadoPublicoScraperController = class MercadoPublicoScraperController {
    scraperService;
    constructor(scraperService) {
        this.scraperService = scraperService;
    }
    async search(query) {
        if (!query) {
            return { error: 'Debe proporcionar un término de búsqueda (parámetro q)' };
        }
        return this.scraperService.searchAll(query);
    }
    async consultarOC(id) {
        if (!id) {
            return { error: 'Debe proporcionar un ID de licitación' };
        }
        return this.scraperService.consultarOC(id);
    }
};
exports.MercadoPublicoScraperController = MercadoPublicoScraperController;
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MercadoPublicoScraperController.prototype, "search", null);
__decorate([
    (0, common_1.Post)('consultar-oc'),
    __param(0, (0, common_1.Body)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MercadoPublicoScraperController.prototype, "consultarOC", null);
exports.MercadoPublicoScraperController = MercadoPublicoScraperController = __decorate([
    (0, common_1.Controller)('mercadopublico-web'),
    __metadata("design:paramtypes", [mercadopublico_scraper_service_1.MercadoPublicoScraperService])
], MercadoPublicoScraperController);
//# sourceMappingURL=mercadopublico-scraper.controller.js.map
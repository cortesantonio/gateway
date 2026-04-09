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
exports.MercadoPublicoService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const cache_manager_1 = require("@nestjs/cache-manager");
const schedule_1 = require("@nestjs/schedule");
const rxjs_1 = require("rxjs");
let MercadoPublicoService = class MercadoPublicoService {
    httpService;
    configService;
    cacheManager;
    baseUrl = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';
    webhookUrl;
    ticket;
    constructor(httpService, configService, cacheManager) {
        this.httpService = httpService;
        this.configService = configService;
        this.cacheManager = cacheManager;
        this.ticket = this.configService.get('MERCADO_PUBLICO_TICKET') || '';
        this.webhookUrl = this.configService.get('MERCADO_PUBLICO_WEBHOOK_URL') || '';
    }
    async handleCron() {
        console.log('[MercadoPublico] CRON: Iniciando actualización automática desde webhook...');
        await this.findAll();
        console.log('[MercadoPublico] CRON: Cache actualizado exitosamente.');
    }
    async findAll(fecha) {
        const cacheKey = `mp_list_${fecha || 'filtered'}`;
        const cachedData = await this.cacheManager.get(cacheKey);
        if (cachedData) {
            console.log(`[MercadoPublico] Cache HIT [Webhook] for key: ${cacheKey}`);
            return cachedData;
        }
        try {
            console.log(`[MercadoPublico] API CALL: Fetching list from internal webhook...`);
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.get(this.webhookUrl));
            if (!Array.isArray(data) || data.length === 0) {
                return { Cantidad: 0, Listado: [], message: 'No se encontraron licitaciones en el webhook' };
            }
            const listado = data.map((item) => ({
                CodigoExterno: item.id_licitacion,
                Nombre: item.titulo,
                MontoEstimado: item.monto,
                Estado: item.estado,
                UrlFicha: item.url_ficha,
                ...item
            }));
            const transformedData = {
                Cantidad: listado.length,
                Listado: listado
            };
            await this.cacheManager.set(cacheKey, transformedData);
            return transformedData;
        }
        catch (error) {
            console.error('[MercadoPublico] Error calling webhook:', error.message);
            throw new common_1.HttpException('Error al conectar con el webhook interno de licitaciones', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async findOne(codigo) {
        try {
            const url = new URL(this.baseUrl);
            url.searchParams.append('ticket', this.ticket);
            url.searchParams.append('codigo', codigo);
            console.log(`[MercadoPublico] API CALL (REAL-TIME OFFICIAL): Fetching detail for ${codigo}`);
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.get(url.toString()));
            if (!data || data.Cantidad === 0) {
                throw new common_1.HttpException('Licitación no encontrada en Mercado Público', common_1.HttpStatus.NOT_FOUND);
            }
            return data;
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error.response?.data || 'Error al consultar detalle oficial de licitación', error.response?.status || common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async searchSimilar(query) {
        const cacheKey = `mp_search_${query.toLowerCase()}`;
        const cachedData = await this.cacheManager.get(cacheKey);
        if (cachedData) {
            console.log(`[MercadoPublico] Cache HIT for key: ${cacheKey}`);
            return cachedData;
        }
        const webhookData = await this.findAll();
        if (!webhookData || !webhookData.Listado)
            return { Cantidad: 0, Listado: [] };
        const filtered = webhookData.Listado.filter((l) => l.Nombre?.toLowerCase().includes(query.toLowerCase()) ||
            l.CodigoExterno?.toLowerCase().includes(query.toLowerCase()));
        const result = {
            Cantidad: filtered.length,
            Listado: filtered
        };
        await this.cacheManager.set(cacheKey, result);
        return result;
    }
};
exports.MercadoPublicoService = MercadoPublicoService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_30_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MercadoPublicoService.prototype, "handleCron", null);
exports.MercadoPublicoService = MercadoPublicoService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService, Object])
], MercadoPublicoService);
//# sourceMappingURL=mercadopublico.service.js.map
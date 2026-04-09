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
var MercadoPublicoScraperService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPublicoScraperService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const rxjs_1 = require("rxjs");
const cheerio = __importStar(require("cheerio"));
let MercadoPublicoScraperService = MercadoPublicoScraperService_1 = class MercadoPublicoScraperService {
    httpService;
    logger = new common_1.Logger(MercadoPublicoScraperService_1.name);
    searchUrl = 'https://www.mercadopublico.cl/BuscarLicitacion/Home/Buscar';
    constructor(httpService) {
        this.httpService = httpService;
    }
    async searchAll(query) {
        let allResults = [];
        let currentPage = 0;
        let totalResults = 0;
        const pageSize = 10;
        const fechaFin = new Date();
        const fechaInicio = new Date();
        fechaInicio.setMonth(fechaInicio.getMonth() - 6);
        try {
            while (true) {
                this.logger.log(`Scraping page ${currentPage} for query: ${query}`);
                const payload = {
                    textoBusqueda: query,
                    idEstado: '-1',
                    codigoRegion: '-1',
                    idTipoLicitacion: '-1',
                    fechaInicio: fechaInicio.toISOString(),
                    fechaFin: fechaFin.toISOString(),
                    registrosPorPagina: pageSize.toString(),
                    idTipoFecha: [],
                    idOrden: '1',
                    compradores: [],
                    garantias: null,
                    rubros: [],
                    proveedores: [],
                    montoEstimadoTipo: [0],
                    esPublicoMontoEstimado: null,
                    pagina: currentPage,
                };
                const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(this.searchUrl, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': '*/*',
                    },
                }));
                const html = response.data;
                const $ = cheerio.load(html);
                if (currentPage === 0) {
                    const totalText = $('.n-result').text().trim();
                    totalResults = parseInt(totalText) || 0;
                    this.logger.log(`Total results found: ${totalResults}`);
                }
                const pageResults = this.parseHtml($);
                allResults = [...allResults, ...pageResults];
                if (allResults.length >= totalResults || pageResults.length === 0 || currentPage > 50) {
                    break;
                }
                currentPage++;
            }
            return {
                totalFound: totalResults,
                count: allResults.length,
                results: allResults,
            };
        }
        catch (error) {
            this.logger.error(`Error scraping Mercado Publico: ${error.message}`);
            throw error;
        }
    }
    async consultarOC(id) {
        const webhookUrl = 'http://192.168.23.217:5678/webhook/consultaroc';
        this.logger.log(`Consulting OC for ID: ${id} at ${webhookUrl}`);
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(webhookUrl, { id }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': '*/*',
                },
            }));
            return response.data;
        }
        catch (error) {
            this.logger.error(`Error consulting OC: ${error.message}`);
            throw error;
        }
    }
    parseHtml($) {
        const items = [];
        $('.lic-bloq-wrap').each((index, element) => {
            const row = $(element);
            const idLicitacion = row.find('.id-licitacion span.clearfix').text().trim();
            const estado = row.find('.estado-texto').text().trim();
            const titulo = row.find('h2.text-weight-light').text().trim();
            const descripcion = row.find('p.text-weight-light').first().text().trim();
            const montoLabel = row.find('.monto-dis strong').text().trim();
            let montoValor = row.find('.monto-dis .campo-numerico-punto-coma').text().trim();
            if (!montoValor) {
                montoValor = row.find('.monto-dis .monto-no-publico').text().trim();
            }
            const getLabelValue = (label) => {
                const strong = row.find(`p strong:contains("${label}")`);
                if (strong.length > 0) {
                    let value = strong.closest('div').find('span').text().trim();
                    if (value.includes('(')) {
                        value = value.split('(')[0].trim();
                    }
                    return value;
                }
                return '';
            };
            const fechaPublicacion = getLabelValue('Fecha de publicación');
            const fechaCierre = getLabelValue('Fecha de cierre');
            const compradorPrincipal = row.find('.lic-bloq-footer strong').first().text().trim();
            const organismoDetalle = row.find('.lic-bloq-footer p').first().text().trim();
            const onclickAttr = row.find('a[onclick*="verFicha"]').attr('onclick');
            let urlFicha = '';
            if (onclickAttr) {
                const match = onclickAttr.match(/'([^']+)'/);
                if (match)
                    urlFicha = match[1];
            }
            items.push({
                idLicitacion,
                estado,
                titulo,
                descripcion,
                monto: {
                    tipo: montoLabel,
                    valor: montoValor
                },
                fechaPublicacion,
                fechaCierre,
                comprador: {
                    principal: compradorPrincipal,
                    organismo: organismoDetalle
                },
                urlFicha
            });
        });
        return items;
    }
};
exports.MercadoPublicoScraperService = MercadoPublicoScraperService;
exports.MercadoPublicoScraperService = MercadoPublicoScraperService = MercadoPublicoScraperService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService])
], MercadoPublicoScraperService);
//# sourceMappingURL=mercadopublico-scraper.service.js.map
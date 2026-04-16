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
exports.MercadoPublicoController = void 0;
const common_1 = require("@nestjs/common");
const mercadopublico_service_1 = require("./mercadopublico.service");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
let MercadoPublicoController = class MercadoPublicoController {
    mpService;
    constructor(mpService) {
        this.mpService = mpService;
    }
    findAll(fecha) {
        return this.mpService.findAll(fecha);
    }
    search(query) {
        return this.mpService.searchSimilar(query);
    }
    searchSimilar(query) {
        return this.mpService.searchSimilar(query);
    }
    findOne(codigo) {
        return this.mpService.findOne(codigo);
    }
};
exports.MercadoPublicoController = MercadoPublicoController;
__decorate([
    (0, common_1.Get)('licitaciones'),
    __param(0, (0, common_1.Query)('fecha')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MercadoPublicoController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('licitaciones/search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MercadoPublicoController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('licitaciones/search-similar'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MercadoPublicoController.prototype, "searchSimilar", null);
__decorate([
    (0, common_1.Get)('licitaciones/:codigo'),
    __param(0, (0, common_1.Param)('codigo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MercadoPublicoController.prototype, "findOne", null);
exports.MercadoPublicoController = MercadoPublicoController = __decorate([
    (0, common_1.Controller)('mercadopublico'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __metadata("design:paramtypes", [mercadopublico_service_1.MercadoPublicoService])
], MercadoPublicoController);
//# sourceMappingURL=mercadopublico.controller.js.map
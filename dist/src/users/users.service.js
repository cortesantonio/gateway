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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../auth/supabase.service");
let UsersService = class UsersService {
    supabaseService;
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async changeUserPassword(userId, newPassword) {
        const adminClient = this.supabaseService.getAdminClient();
        const { data, error } = await adminClient.auth.admin.updateUserById(userId, {
            password: newPassword,
        });
        if (error) {
            console.error('Error cambiando contraseña en Supabase Auth:', error);
            throw new common_1.BadRequestException(error.message);
        }
        return data.user;
    }
    async createAuthUser(email, password) {
        const adminClient = this.supabaseService.getAdminClient();
        const { data, error } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });
        if (error) {
            console.error('Error creando usuario en Supabase Auth:', error);
            throw new common_1.BadRequestException(error.message);
        }
        return data.user;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], UsersService);
//# sourceMappingURL=users.service.js.map
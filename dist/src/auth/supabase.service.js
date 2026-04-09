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
exports.SupabaseService = void 0;
const common_1 = require("@nestjs/common");
const supabase_js_1 = require("@supabase/supabase-js");
let SupabaseService = class SupabaseService {
    supabase;
    adminSupabase = null;
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error('Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY son requeridas');
        }
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
        if (supabaseServiceRoleKey) {
            this.adminSupabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                }
            });
        }
    }
    async validateToken(token) {
        try {
            const cleanToken = token.startsWith('Bearer ')
                ? token.substring(7)
                : token;
            const { data: { user }, error, } = await this.supabase.auth.getUser(cleanToken);
            if (error || !user) {
                return null;
            }
            return user;
        }
        catch (error) {
            return null;
        }
    }
    getClient() {
        return this.supabase;
    }
    getAdminClient() {
        if (!this.adminSupabase) {
            throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada');
        }
        return this.adminSupabase;
    }
};
exports.SupabaseService = SupabaseService;
exports.SupabaseService = SupabaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SupabaseService);
//# sourceMappingURL=supabase.service.js.map
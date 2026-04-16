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
var MonitoringService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringService = void 0;
const common_1 = require("@nestjs/common");
const cache_manager_1 = require("@nestjs/cache-manager");
const supabase_service_1 = require("../auth/supabase.service");
let MonitoringService = MonitoringService_1 = class MonitoringService {
    supabaseService;
    cacheManager;
    flatAppointments = [];
    syncInterval = null;
    logger = new common_1.Logger(MonitoringService_1.name);
    constructor(supabaseService, cacheManager) {
        this.supabaseService = supabaseService;
        this.cacheManager = cacheManager;
    }
    async onModuleInit() {
        this.logger.log('Inicializando caché de datos planos...');
        await this.syncAllData();
        this.syncInterval = setInterval(() => {
            this.syncAllData();
        }, 5 * 60 * 1000);
    }
    onModuleDestroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
    }
    async syncAllData() {
        try {
            this.logger.log('Sincronizando todas las citas desde Supabase...');
            const supabase = this.supabaseService.getAdminClient();
            let allAppointments = [];
            let hasMore = true;
            let page = 0;
            const limit = 1000;
            while (hasMore) {
                const startRange = page * limit;
                const endRange = startRange + limit - 1;
                const { data, error } = await supabase
                    .from('notificacion_cita')
                    .select('establecimiento, estado_envio, estado_confirmacion, created_at, fecha_envio, fecha_confirmacion, nombre_paciente, fecha_cita, hora_cita, link_opened_at, tipo_atencion')
                    .eq('activo', true)
                    .range(startRange, endRange);
                if (error)
                    throw error;
                if (data && data.length > 0) {
                    allAppointments = allAppointments.concat(data);
                }
                if (!data || data.length < limit) {
                    hasMore = false;
                }
                else {
                    page++;
                }
            }
            this.flatAppointments = allAppointments;
            this.logger.log(`Sincronización completa. Registros en memoria: ${this.flatAppointments.length}`);
        }
        catch (error) {
            this.logger.error('Error sincronizando datos planos:', error);
        }
    }
    async getMonitoringStats(startDate, endDate) {
        const cacheKey = `monitoring_stats_${startDate}_${endDate}`;
        const cachedData = await this.cacheManager.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }
        const filteredAppointments = this.flatAppointments.filter(app => {
            if (!app.created_at)
                return false;
            const createdAt = app.created_at;
            return createdAt >= `${startDate}T00:00:00` && createdAt <= `${endDate}T23:59:59`;
        });
        if (filteredAppointments.length === 0)
            return this.getEmptyStats();
        const stats = this.calculateStatsFromData(filteredAppointments, startDate, endDate);
        await this.cacheManager.set(cacheKey, stats, 5 * 60 * 1000);
        return stats;
    }
    getFlatAppointments() {
        return this.flatAppointments;
    }
    calculateStatsFromData(allAppointments, startDate, endDate) {
        const totalCargadas = allAppointments.length;
        const enviadas = allAppointments.filter(a => a.estado_envio === 'enviado');
        const totalEnviadas = enviadas.length;
        const confirmed = enviadas.filter(a => a.estado_confirmacion === 'confirmado').length;
        const rejected = enviadas.filter(a => a.estado_confirmacion === 'rechazado').length;
        const pending = enviadas.filter(a => a.estado_confirmacion === 'pendiente').length;
        const noResponse = enviadas.filter(a => a.estado_confirmacion === 'no_responde').length;
        const notSent = totalCargadas - totalEnviadas;
        const contactRate = totalEnviadas > 0 ? Math.round(((confirmed + rejected) / totalEnviadas) * 100) : 0;
        const stats = {
            totalCargadas,
            total: totalEnviadas,
            confirmed,
            rejected,
            pending,
            noResponse,
            notSent,
            contactRate
        };
        const byEstablishment = {};
        allAppointments.forEach(app => {
            const name = app.establecimiento || 'Sin Establecimiento';
            if (!byEstablishment[name]) {
                byEstablishment[name] = { totalCargadas: 0, total: 0, confirmed: 0, rejected: 0, pending: 0, noResponse: 0 };
            }
            byEstablishment[name].totalCargadas++;
            if (app.estado_envio === 'enviado') {
                byEstablishment[name].total++;
                if (app.estado_confirmacion === 'confirmado')
                    byEstablishment[name].confirmed++;
                else if (app.estado_confirmacion === 'rechazado')
                    byEstablishment[name].rejected++;
                else if (app.estado_confirmacion === 'pendiente')
                    byEstablishment[name].pending++;
                else if (app.estado_confirmacion === 'no_responde')
                    byEstablishment[name].noResponse++;
            }
        });
        const daysInRange = this.getDaysInRange(startDate, endDate);
        const dailyCreation = daysInRange.map(date => ({
            date,
            count: allAppointments.filter(a => a.created_at.startsWith(date)).length
        }));
        const dailyCreationByEstablishment = {};
        Object.keys(byEstablishment).forEach(est => {
            dailyCreationByEstablishment[est] = daysInRange.map(date => ({
                date,
                count: allAppointments.filter(a => a.establecimiento === est && a.created_at.startsWith(date)).length
            }));
        });
        const dailyActivity = daysInRange.map(date => ({
            date,
            sent: allAppointments.filter(a => a.estado_envio === 'enviado' && a.fecha_envio?.startsWith(date)).length,
            confirmed: allAppointments.filter(a => a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion?.startsWith(date)).length,
            rejected: allAppointments.filter(a => a.estado_confirmacion === 'rechazado' && a.fecha_confirmacion?.startsWith(date)).length,
        }));
        const activityByEstablishmentDaily = {};
        Object.keys(byEstablishment).forEach(est => {
            activityByEstablishmentDaily[est] = daysInRange.map(date => ({
                date,
                sent: allAppointments.filter(a => a.establecimiento === est && a.estado_envio === 'enviado' && a.fecha_envio?.startsWith(date)).length,
                confirmed: allAppointments.filter(a => a.establecimiento === est && a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion?.startsWith(date)).length,
                rejected: allAppointments.filter(a => a.establecimiento === est && a.estado_confirmacion === 'rechazado' && a.fecha_confirmacion?.startsWith(date)).length,
            }));
        });
        const recentActivity = allAppointments
            .filter(a => a.estado_confirmacion === 'confirmado' && a.fecha_confirmacion)
            .sort((a, b) => new Date(b.fecha_confirmacion).getTime() - new Date(a.fecha_confirmacion).getTime())
            .slice(0, 10)
            .map(this.mapToFrontend);
        const recentNotifications = allAppointments
            .filter(a => a.estado_envio === 'enviado' && a.fecha_envio)
            .sort((a, b) => new Date(b.fecha_envio).getTime() - new Date(a.fecha_envio).getTime())
            .slice(0, 10)
            .map(this.mapToFrontend);
        const recentCreatedAppointments = [...allAppointments]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 10)
            .map(this.mapToFrontend);
        return {
            stats,
            byEstablishment,
            recentActivity,
            recentNotifications,
            recentCreatedAppointments,
            dailyCreation,
            dailyCreationByEstablishment,
            dailyActivity,
            activityByEstablishmentDaily
        };
    }
    mapToFrontend(item) {
        return {
            id: item.id,
            nombrePaciente: item.nombre_paciente,
            fechaCita: item.fecha_cita,
            horaCita: item.hora_cita,
            establecimiento: item.establecimiento,
            estadoConfirmacion: item.estado_confirmacion,
            estadoEnvio: item.estado_envio,
            fechaConfirmacion: item.fecha_confirmacion,
            fechaEnvio: item.fecha_envio,
            createdAt: item.created_at,
            linkOpenedAt: item.link_opened_at
        };
    }
    getDaysInRange(start, end) {
        const days = [];
        let current = new Date(start);
        const last = new Date(end);
        while (current <= last) {
            days.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        return days;
    }
    getEmptyStats() {
        return {
            stats: { totalCargadas: 0, total: 0, confirmed: 0, rejected: 0, pending: 0, noResponse: 0, notSent: 0, contactRate: 0 },
            byEstablishment: {},
            recentActivity: [],
            recentNotifications: [],
            recentCreatedAppointments: [],
            dailyCreation: [],
            dailyCreationByEstablishment: {},
            dailyActivity: [],
            activityByEstablishmentDaily: {}
        };
    }
};
exports.MonitoringService = MonitoringService;
exports.MonitoringService = MonitoringService = MonitoringService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService, Object])
], MonitoringService);
//# sourceMappingURL=monitoring.service.js.map
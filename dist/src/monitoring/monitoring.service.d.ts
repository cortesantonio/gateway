import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { SupabaseService } from '../auth/supabase.service';
export declare class MonitoringService implements OnModuleInit, OnModuleDestroy {
    private readonly supabaseService;
    private cacheManager;
    private flatAppointments;
    private syncInterval;
    private readonly logger;
    constructor(supabaseService: SupabaseService, cacheManager: Cache);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    private syncAllData;
    getMonitoringStats(startDate: string, endDate: string): Promise<{}>;
    getFlatAppointments(): any[];
    private calculateStatsFromData;
    private mapToFrontend;
    private getDaysInRange;
    private getEmptyStats;
}

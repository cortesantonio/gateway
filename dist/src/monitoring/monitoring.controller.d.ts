import { MonitoringService } from './monitoring.service';
export declare class MonitoringController {
    private readonly monitoringService;
    constructor(monitoringService: MonitoringService);
    getStats(startDate: string, endDate: string): Promise<{}>;
    getFlatData(): any[];
}

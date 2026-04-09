import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
export declare class MercadoPublicoService {
    private readonly httpService;
    private readonly configService;
    private cacheManager;
    private readonly baseUrl;
    private readonly webhookUrl;
    private readonly ticket;
    constructor(httpService: HttpService, configService: ConfigService, cacheManager: Cache);
    handleCron(): Promise<void>;
    findAll(fecha?: string): Promise<{}>;
    findOne(codigo: string): Promise<any>;
    searchSimilar(query: string): Promise<{}>;
}

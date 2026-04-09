import { MercadoPublicoScraperService, ScraperResult } from './mercadopublico-scraper.service';
export declare class MercadoPublicoScraperController {
    private readonly scraperService;
    constructor(scraperService: MercadoPublicoScraperService);
    search(query: string): Promise<{
        totalFound: number;
        count: number;
        results: ScraperResult[];
    } | {
        error: string;
    }>;
    consultarOC(id: string): Promise<any>;
}

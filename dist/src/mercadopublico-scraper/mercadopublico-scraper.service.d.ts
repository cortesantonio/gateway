import { HttpService } from '@nestjs/axios';
export interface ScraperResult {
    idLicitacion: string;
    estado: string;
    titulo: string;
    descripcion: string;
    monto: {
        tipo: string;
        valor: string;
    };
    fechaPublicacion: string;
    fechaCierre: string;
    comprador: {
        principal: string;
        organismo: string;
    };
    urlFicha: string;
}
export declare class MercadoPublicoScraperService {
    private readonly httpService;
    private readonly logger;
    private readonly searchUrl;
    constructor(httpService: HttpService);
    searchAll(query: string): Promise<{
        totalFound: number;
        count: number;
        results: ScraperResult[];
    }>;
    consultarOC(id: string): Promise<any>;
    private parseHtml;
}

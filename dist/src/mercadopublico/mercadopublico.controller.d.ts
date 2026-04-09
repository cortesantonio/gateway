import { MercadoPublicoService } from './mercadopublico.service';
export declare class MercadoPublicoController {
    private readonly mpService;
    constructor(mpService: MercadoPublicoService);
    findAll(fecha?: string): Promise<{}>;
    search(query: string): Promise<{}>;
    searchSimilar(query: string): Promise<{}>;
    findOne(codigo: string): Promise<any>;
}

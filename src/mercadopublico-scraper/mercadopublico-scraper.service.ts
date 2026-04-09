import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';

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

@Injectable()
export class MercadoPublicoScraperService {
  private readonly logger = new Logger(MercadoPublicoScraperService.name);
  private readonly searchUrl = 'https://www.mercadopublico.cl/BuscarLicitacion/Home/Buscar';

  constructor(private readonly httpService: HttpService) { }

  async searchAll(query: string) {
    let allResults: ScraperResult[] = [];
    let currentPage = 0;
    let totalResults = 0;
    const pageSize = 10;

    // Obtener la fecha de inicio (6 meses atrás) y fin (hoy)
    const fechaFin = new Date();
    const fechaInicio = new Date();
    fechaInicio.setMonth(fechaInicio.getMonth() - 6);

    try {
      while (true) {
        this.logger.log(`Scraping page ${currentPage} for query: ${query}`);

        const payload = {
          textoBusqueda: query,
          idEstado: '-1',
          codigoRegion: '-1',
          idTipoLicitacion: '-1',
          fechaInicio: fechaInicio.toISOString(),
          fechaFin: fechaFin.toISOString(),
          registrosPorPagina: pageSize.toString(),
          idTipoFecha: [],
          idOrden: '1',
          compradores: [],
          garantias: null,
          rubros: [],
          proveedores: [],
          montoEstimadoTipo: [0],
          esPublicoMontoEstimado: null,
          pagina: currentPage,
        };

        const response = await firstValueFrom(
          this.httpService.post(this.searchUrl, payload, {
            headers: {
              'Content-Type': 'application/json',
              'Accept': '*/*',
            },
          })
        );

        const html = response.data;
        const $ = cheerio.load(html);

        // En la primera página, determinamos el total de resultados
        if (currentPage === 0) {
          const totalText = $('.n-result').text().trim();
          totalResults = parseInt(totalText) || 0;
          this.logger.log(`Total results found: ${totalResults}`);
        }

        const pageResults = this.parseHtml($);
        allResults = [...allResults, ...pageResults];

        // Verificar si hay más páginas
        if (allResults.length >= totalResults || pageResults.length === 0 || currentPage > 50) {
          break;
        }

        currentPage++;
      }

      return {
        totalFound: totalResults,
        count: allResults.length,
        results: allResults,
      };
    } catch (error) {
      this.logger.error(`Error scraping Mercado Publico: ${error.message}`);
      throw error;
    }
  }

  async consultarOC(id: string) {
    const webhookUrl = 'http://192.168.23.217:5678/webhook/consultaroc';
    this.logger.log(`Consulting OC for ID: ${id} at ${webhookUrl}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(webhookUrl, { id }, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': '*/*',
          },
        })
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Error consulting OC: ${error.message}`);
      throw error;
    }
  }

  private parseHtml($: cheerio.CheerioAPI): ScraperResult[] {
    const items: ScraperResult[] = [];

    $('.lic-bloq-wrap').each((index, element) => {
      const row = $(element);

      const idLicitacion = row.find('.id-licitacion span.clearfix').text().trim();
      const estado = row.find('.estado-texto').text().trim();
      const titulo = row.find('h2.text-weight-light').text().trim();
      const descripcion = row.find('p.text-weight-light').first().text().trim();

      // Montos y Fechas
      const montoLabel = row.find('.monto-dis strong').text().trim();
      let montoValor = row.find('.monto-dis .campo-numerico-punto-coma').text().trim();
      
      // Si no hay monto numérico, podría ser un intervalo (monto-no-publico)
      if (!montoValor) {
        montoValor = row.find('.monto-dis .monto-no-publico').text().trim();
      }

      // Función para obtener valor basado en la etiqueta "strong" que lo antecede
      const getLabelValue = (label: string) => {
        const strong = row.find(`p strong:contains("${label}")`);
        if (strong.length > 0) {
          // Buscamos el span resaltado o normal que esté en el mismo contenedor
          let value = strong.closest('div').find('span').text().trim();
          // Limpiar si trae información de tiempo restante (ej: "10/04/2026(En 2 días)")
          if (value.includes('(')) {
            value = value.split('(')[0].trim();
          }
          return value;
        }
        return '';
      };

      const fechaPublicacion = getLabelValue('Fecha de publicación');
      const fechaCierre = getLabelValue('Fecha de cierre');

      // Comprador
      const compradorPrincipal = row.find('.lic-bloq-footer strong').first().text().trim();
      const organismoDetalle = row.find('.lic-bloq-footer p').first().text().trim();

      // URL Ficha (extraída del onclick)
      const onclickAttr = row.find('a[onclick*="verFicha"]').attr('onclick');
      let urlFicha = '';
      if (onclickAttr) {
        const match = onclickAttr.match(/'([^']+)'/);
        if (match) urlFicha = match[1];
      }

      items.push({
        idLicitacion,
        estado,
        titulo,
        descripcion,
        monto: {
          tipo: montoLabel,
          valor: montoValor
        },
        fechaPublicacion,
        fechaCierre,
        comprador: {
          principal: compradorPrincipal,
          organismo: organismoDetalle
        },
        urlFicha
      });
    });

    return items;
  }
}

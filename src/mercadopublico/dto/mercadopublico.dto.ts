export class LicitacionFilterDto {
  codigo?: string;
  estado?: string;
  organismo?: string;
  proveedor?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  pagina?: number;
  limite?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export class OrdenCompraFilterDto {
  codigo?: string;
  estado?: string;
  organismo?: string;
  proveedor?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  pagina?: number;
  limite?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

// Normalized Output DTOs
export class NormalizedLicitacionDto {
  codigo: string;
  nombre: string;
  estado: string;
  fechaPublicacion: string;
  fechaCierre: string;
  montoEstimado: number;
  organismo: {
    codigo: string;
    nombre: string;
  };
  proveedor?: {
    rut: string;
    nombre: string;
  };
}

export class NormalizedOrdenCompraDto {
  codigo: string;
  nombre: string;
  estado: string;
  fechaEmision: string;
  montoTotal: number;
  organismo: {
    codigo: string;
    nombre: string;
  };
  proveedor: {
    rut: string;
    nombre: string;
    codigo: string;
  };
}

export class NormalizedResponse<T> {
  data: T[];
  total: number;
  pagina: number;
  limite: number;
}

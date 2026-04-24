import { Injectable, BadRequestException, NotFoundException, OnModuleInit, HttpStatus } from '@nestjs/common';
import { extname } from 'path';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService implements OnModuleInit {
  private minioClient: Minio.Client;
  private readonly bucketName = 'files';
  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // Excel & CSV
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'text/plain', // Some browsers send CSV as text/plain
    // Videos & WebP
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'image/webp',
    'text/plain',
  ];
  private readonly allowedExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
    '.mp4', '.mov', '.avi', '.webm', '.webp', '.txt'
  ];
  private readonly blockedDoubleExtensions = ['.exe', '.com', '.bat', '.cmd', '.sh', '.msi', '.js', '.jar', '.vbs', '.ps1', '.php', '.py', '.rb'];
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

  constructor() {
    const endPoint = process.env.MINIO_ENDPOINT;
    const port = parseInt(process.env.MINIO_PORT || '9000', 10);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;

    if (!endPoint || !accessKey || !secretKey) {
      throw new Error(
        'Las variables de entorno MINIO_ENDPOINT, MINIO_ACCESS_KEY y MINIO_SECRET_KEY son requeridas',
      );
    }

    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit() {
    // Verificar si el bucket existe, si no, crearlo
    const bucketExists = await this.minioClient.bucketExists(this.bucketName);
    if (!bucketExists) {
      await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
      console.log(`Bucket "${this.bucketName}" creado exitosamente`);
    }
  }

  /**
   * Valida el archivo antes de subirlo
   */
  validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    // Validar tamaño
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    // Validar extensión
    const normalizedOriginalName = file.originalname.toLowerCase();
    if (this.hasSuspiciousDoubleExtension(normalizedOriginalName)) {
      throw new BadRequestException('Nombre de archivo inválido o contiene extensiones peligrosas');
    }

    const fileExtension = extname(file.originalname).toLowerCase();
    if (!this.allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido. Extensiones permitidas: ${this.allowedExtensions.join(', ')}`,
      );
    }

    // Validar MIME type
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Tipo MIME no permitido');
    }
  }

  /**
   * Valida exclusivamente oficios (solo PDF)
   */
  validateOficio(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    const fileExtension = extname(file.originalname).toLowerCase();
    if (fileExtension !== '.pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF para oficios');
    }

    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Tipo MIME inválido. Solo se acepta application/pdf');
    }
  }

  /**
   * Valida archivos de carga masiva de citas (Excel o CSV)
   */
  validateCitas(file: Express.Multer.File): void {
    this._validateSpreadsheet(file, 'citas');
  }

  /**
   * Valida archivos de carga masiva de funcionarios (Excel o CSV)
   */
  validateFuncionarios(file: Express.Multer.File): void {
    this._validateSpreadsheet(file, 'funcionarios');
  }

  /**
   * Lógica común para validar hojas de cálculo (Excel / CSV)
   */
  private _validateSpreadsheet(file: Express.Multer.File, context: string): void {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    const allowedSpreadsheetExtensions = ['.xls', '.xlsx', '.csv'];
    const fileExtension = extname(file.originalname).toLowerCase();

    if (!allowedSpreadsheetExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido para ${context}. Solo se permiten archivos Excel (.xls, .xlsx) y CSV (.csv).`,
      );
    }

    const allowedSpreadsheetMimeTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'text/plain', // Some browsers/OS send CSV as text/plain
    ];

    if (!allowedSpreadsheetMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato de archivo inválido para ${context}. MIME type no permitido: ${file.mimetype}`,
      );
    }
  }

  /**
   * Valida exclusivamente boletas (solo PDF e imágenes)
   */
  validateBoleta(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    // Validar tamaño
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    // Validar extensión estricta
    const allowedBoletaExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    const fileExtension = extname(file.originalname).toLowerCase();

    if (!allowedBoletaExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido para boletas. Solo se permiten imágenes (JPG, PNG) y PDF.`,
      );
    }

    // Validar MIME type estricto
    const allowedBoletaMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf',
    ];

    if (!allowedBoletaMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Formato de archivo inválido para boleta');
    }
  }

  /**
   * Valida archivos de evidencia para tickets (Documentos, Fotos, Videos, etc)
   * Límite: 25MB
   */
  validateTicket(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    const maxTicketSize = 25 * 1024 * 1024; // 25MB

    // Validar tamaño
    if (file.size > maxTicketSize) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido para tickets de 25MB`,
      );
    }

    // Validar extensión
    const normalizedOriginalName = file.originalname.toLowerCase();
    if (this.hasSuspiciousDoubleExtension(normalizedOriginalName)) {
      throw new BadRequestException('Nombre de archivo inválido o contiene extensiones peligrosas');
    }

    const fileExtension = extname(file.originalname).toLowerCase();
    if (!this.allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido para tickets. Extensiones permitidas: ${this.allowedExtensions.join(', ')}`,
      );
    }

    // Validar MIME type
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo MIME no permitido para tickets: ${file.mimetype}`);
    }
  }

  /**
   * Genera un nombre único para el archivo
   */
  generateFileName(originalName: string): string {
    const fileExtension = extname(originalName).toLowerCase();
    return `${randomUUID()}${fileExtension}`;
  }

  /**
   * Normaliza y sanitiza el nombre del archivo (o ruta) para evitar path traversal.
   * Permite separadores '/' para admitir rutas con capetas (ej. 'oficios/uuid.pdf').
   */
  private sanitizeFilename(filename: string): string {
    // Normalizar: reemplazar \\ por /, luego dividir en segmentos
    const segments = filename.replace(/\\/g, '/').split('/');

    const sanitized = segments
      .map((seg) => seg.replace(/\.\./g, '').replace(/[\\]/g, '').trim()) // eliminar .. y backslashes por segmento
      .filter((seg) => seg.length > 0)
      .join('/');

    if (!sanitized) {
      throw new BadRequestException('Nombre de archivo inválido');
    }

    return sanitized;
  }

  /**
   * Sube un archivo a MinIO.
   * @param folder  Carpeta opcional (prefijo) dentro del bucket, ej. 'oficios', 'citas', 'funcionarios'.
   *                Si se omite, el archivo se almacena en la raíz del bucket.
   * @returns       La clave completa con la que se almacena en MinIO (incluye carpeta si se especificó).
   */
  async uploadFile(file: Express.Multer.File, filename: string, folder?: string): Promise<string> {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      // Construir la clave MinIO: 'folder/filename' o simplemente 'filename'
      const key = folder ? `${folder}/${sanitizedFilename}` : sanitizedFilename;

      await this.minioClient.putObject(
        this.bucketName,
        key,
        file.buffer,
        file.size,
        {
          'Content-Type': file.mimetype,
          'Original-Name': encodeURIComponent(file.originalname),
          'X-Amz-Acl': 'private',
        },
      );

      return key; // Retorna la clave completa (con carpeta si aplica)
    } catch (error) {
      throw new BadRequestException(`Error al subir el archivo: ${error.message}`);
    }
  }

  /**
   * Verifica si un archivo existe
   */
  async fileExists(filename: string): Promise<boolean> {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      await this.minioClient.statObject(this.bucketName, sanitizedFilename);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Obtiene información del archivo
   */
  async getFileInfo(filename: string) {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      const stat = await this.minioClient.statObject(this.bucketName, sanitizedFilename);

      const originalNameEncoded = stat.metaData['original-name'] || sanitizedFilename;
      let originalName = originalNameEncoded;
      try {
        originalName = decodeURIComponent(originalNameEncoded);
      } catch (e) {
        // Si falla la decodificación, usamos el valor tal cual (compatibilidad hacia atrás)
        originalName = originalNameEncoded;
      }

      return {
        filename: sanitizedFilename,
        size: stat.size,
        contentType: stat.metaData['content-type'] || this.getMimeType(sanitizedFilename),
        originalName: originalName,
        lastModified: stat.lastModified,
        etag: stat.etag,
      };
    } catch (error) {
      if (error.code === 'NotFound' || error.message?.includes('does not exist')) {
        throw new NotFoundException('Archivo no encontrado');
      }
      throw new NotFoundException(`Error al obtener información del archivo: ${error.message}`);
    }
  }

  /**
   * Obtiene el contenido del archivo como buffer
   */
  async getFileBuffer(filename: string): Promise<Buffer> {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      const chunks: Buffer[] = [];

      const dataStream = await this.minioClient.getObject(this.bucketName, sanitizedFilename);

      return new Promise((resolve, reject) => {
        dataStream.on('data', (chunk) => {
          chunks.push(chunk);
        });

        dataStream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        dataStream.on('error', (err: any) => {
          if (err?.code === 'NotFound' || err?.message?.includes('does not exist')) {
            reject(new NotFoundException('Archivo no encontrado'));
          } else {
            reject(new NotFoundException(`Error al obtener el archivo: ${err?.message || 'Error desconocido'}`));
          }
        });
      });
    } catch (error: any) {
      if (error?.status === HttpStatus.NOT_FOUND || error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Error al obtener el archivo: ${error?.message || 'Error desconocido'}`);
    }
  }

  /**
   * Obtiene el contenido del archivo como stream (ideal para devolverlo como blob)
   */
  async getFileStream(filename: string): Promise<NodeJS.ReadableStream> {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      return await this.minioClient.getObject(this.bucketName, sanitizedFilename);
    } catch (error: any) {
      if (error?.code === 'NotFound' || error?.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException('Archivo no encontrado');
      }
      throw new NotFoundException(`Error al obtener el archivo: ${error?.message || 'Error desconocido'}`);
    }
  }

  /**
   * Genera un enlace prefirmado con expiración corta para realizar descargas seguras
   */
  async generatePresignedUrl(filename: string, expirySeconds = 60): Promise<string> {
    try {
      if (expirySeconds <= 0 || expirySeconds > 24 * 60 * 60) {
        throw new BadRequestException('El tiempo de expiración debe estar entre 1 segundo y 24 horas');
      }

      const sanitizedFilename = this.sanitizeFilename(filename);
      return await this.minioClient.presignedGetObject(
        this.bucketName,
        sanitizedFilename,
        expirySeconds,
      );
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error?.code === 'NotFound') {
        throw new NotFoundException('Archivo no encontrado');
      }
      throw new NotFoundException(`Error al generar el enlace seguro: ${error?.message || 'Error desconocido'}`);
    }
  }

  /**
   * Obtiene el MIME type del archivo basado en su extensión
   */
  getMimeType(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.csv': 'text/csv',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Procesa un archivo XLS (HTML) de citas y completa la plantilla XLSX
   */
  async processAppointmentExcel(buffer: Buffer): Promise<Buffer> {
    // Usar latin1 para manejar correctamente acentos y Ñ de reportes legacy
    const $ = cheerio.load(buffer.toString('latin1'));

    interface AppointmentData {
      fecha: string;
      hora: string;
      prestacion: string;
      profesional: string;
      tipo: string;
      nombre: string;
      telefono: string;
      establecimiento: string;
      ficha: string;
    }

    const appointments: AppointmentData[] = [];

    // Buscar todas las tablas que contienen datos de citas
    const tables = $('table');

    let currentEstablishment = '';
    let currentProfessional = '';
    let currentUnit = '';

    tables.each((i, table) => {
      const rows = $(table).find('tr');
      const firstRowText = rows.first().text().toLowerCase();

      if (firstRowText.includes('centro de salud')) {
        currentEstablishment = rows.eq(0).find('td').first().text().trim();
        currentUnit = rows.eq(2).find('td').eq(1).text().trim();
        currentProfessional = rows.eq(3).find('td').eq(1).text().trim();
        currentProfessional = currentProfessional.replace(/^\d+\s+/, '').trim();
      } else if (rows.length > 3 && rows.eq(1).text().includes('Hora')) {
        rows.each((j, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 12) {
            const horaAten = cells.eq(0).text().trim();
            if (/\d{2}\/\d{2}\/\d{4}/.test(horaAten)) {
              const [fecha, hora] = horaAten.split(' ');
              const ficha = cells.eq(1).text().trim();
              const nombre = cells.eq(2).text().trim();
              const prestacion = cells.eq(11).text().trim() || cells.eq(9).text().trim();

              const celular = cells.eq(13).text().trim();
              const redFija = cells.eq(14).text().trim();
              const telefono = celular || redFija;

              appointments.push({
                fecha,
                hora,
                prestacion,
                profesional: currentProfessional,
                tipo: currentUnit,
                nombre,
                telefono,
                establecimiento: currentEstablishment,
                ficha
              });
            }
          }
        });
      }
    });

    if (appointments.length === 0) {
      throw new BadRequestException('No se encontraron citas en el archivo proporcionado');
    }

    // Crear un nuevo libro de Excel (limpio)
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Citas');

    // Definir encabezados idénticos a la plantilla original para facilitar copy-paste
    const headers = [
      'Fecha',
      'Hora',
      'Prestacion',
      'Profesional',
      'Tipo',
      'Nombre',
      'Telefono',
      'Email',
      'Indicaciones',
      'Establecimiento',
      'Nota'
    ];
    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true };

    // Añadir los datos en sus columnas correspondientes
    appointments.forEach((app) => {
      const row = worksheet.addRow([]);
      row.getCell(1).value = app.fecha;
      row.getCell(2).value = app.hora;
      row.getCell(3).value = '';
      row.getCell(4).value = app.profesional;
      row.getCell(5).value = ''; // Tipo (eliminado por petición, pero mantenemos la columna)
      row.getCell(6).value = app.nombre;
      row.getCell(7).value = app.telefono;
      row.getCell(8).value = ''; // Email
      row.getCell(9).value = ''; // Indicaciones
      row.getCell(10).value = ''; // Establecimiento (eliminado por petición, columna vacía)
      row.getCell(11).value = app.ficha ? `Ficha: ${app.ficha}` : '';
      row.commit();
    });

    // Ajustar ancho de columnas automáticamente
    worksheet.columns.forEach(column => {
      column.width = 20;
    });

    // Devolver el buffer del archivo generado
    const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return outputBuffer;
  }

  private hasSuspiciousDoubleExtension(filename: string): boolean {
    const sanitizedName = filename.toLowerCase().replace(/\s+/g, '');

    if (this.blockedDoubleExtensions.some((ext) => sanitizedName.includes(`${ext}.`))) {
      return true;
    }

    const allowedPattern = new RegExp(`\\.(${this.allowedExtensions
      .map((ext) => ext.replace('.', ''))
      .join('|')})\\.(${this.allowedExtensions.map((ext) => ext.replace('.', '')).join('|')})$`);

    return allowedPattern.test(sanitizedName);
  }
}


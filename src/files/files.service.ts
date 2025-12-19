import { Injectable, BadRequestException, NotFoundException, OnModuleInit, HttpStatus } from '@nestjs/common';
import { extname } from 'path';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';

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
  ];
  private readonly allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx'];
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
   * Genera un nombre único para el archivo
   */
  generateFileName(originalName: string): string {
    const fileExtension = extname(originalName).toLowerCase();
    return `${randomUUID()}${fileExtension}`;
  }

  /**
   * Normaliza y sanitiza el nombre del archivo para evitar path traversal
   */
  private sanitizeFilename(filename: string): string {
    const sanitized = filename.replace(/\.\./g, '').replace(/[\/\\]/g, '').trim();

    if (!sanitized) {
      throw new BadRequestException('Nombre de archivo inválido');
    }

    return sanitized;
  }

  /**
   * Sube un archivo a MinIO
   */
  async uploadFile(file: Express.Multer.File, filename: string): Promise<string> {
    try {
      // Sanitizar el nombre del archivo para prevenir path traversal
      const sanitizedFilename = this.sanitizeFilename(filename);

      await this.minioClient.putObject(
        this.bucketName,
        sanitizedFilename,
        file.buffer,
        file.size,
        {
          'Content-Type': file.mimetype,
          'Original-Name': encodeURIComponent(file.originalname),
          'X-Amz-Acl': 'private',
        },
      );

      return sanitizedFilename;
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
    };
    return mimeTypes[ext] || 'application/octet-stream';
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


"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilesService = void 0;
const common_1 = require("@nestjs/common");
const path_1 = require("path");
const Minio = __importStar(require("minio"));
const crypto_1 = require("crypto");
let FilesService = class FilesService {
    minioClient;
    bucketName = 'files';
    allowedMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/csv',
        'text/plain',
    ];
    allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv'];
    blockedDoubleExtensions = ['.exe', '.com', '.bat', '.cmd', '.sh', '.msi', '.js', '.jar', '.vbs', '.ps1', '.php', '.py', '.rb'];
    maxFileSize = 10 * 1024 * 1024;
    constructor() {
        const endPoint = process.env.MINIO_ENDPOINT;
        const port = parseInt(process.env.MINIO_PORT || '9000', 10);
        const useSSL = process.env.MINIO_USE_SSL === 'true';
        const accessKey = process.env.MINIO_ACCESS_KEY;
        const secretKey = process.env.MINIO_SECRET_KEY;
        if (!endPoint || !accessKey || !secretKey) {
            throw new Error('Las variables de entorno MINIO_ENDPOINT, MINIO_ACCESS_KEY y MINIO_SECRET_KEY son requeridas');
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
        const bucketExists = await this.minioClient.bucketExists(this.bucketName);
        if (!bucketExists) {
            await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
            console.log(`Bucket "${this.bucketName}" creado exitosamente`);
        }
    }
    validateFile(file) {
        if (!file) {
            throw new common_1.BadRequestException('No se ha proporcionado ningún archivo');
        }
        if (file.size > this.maxFileSize) {
            throw new common_1.BadRequestException(`El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`);
        }
        const normalizedOriginalName = file.originalname.toLowerCase();
        if (this.hasSuspiciousDoubleExtension(normalizedOriginalName)) {
            throw new common_1.BadRequestException('Nombre de archivo inválido o contiene extensiones peligrosas');
        }
        const fileExtension = (0, path_1.extname)(file.originalname).toLowerCase();
        if (!this.allowedExtensions.includes(fileExtension)) {
            throw new common_1.BadRequestException(`Tipo de archivo no permitido. Extensiones permitidas: ${this.allowedExtensions.join(', ')}`);
        }
        if (!this.allowedMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Tipo MIME no permitido');
        }
    }
    validateOficio(file) {
        if (!file) {
            throw new common_1.BadRequestException('No se ha proporcionado ningún archivo');
        }
        if (file.size > this.maxFileSize) {
            throw new common_1.BadRequestException(`El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`);
        }
        const fileExtension = (0, path_1.extname)(file.originalname).toLowerCase();
        if (fileExtension !== '.pdf') {
            throw new common_1.BadRequestException('Solo se permiten archivos PDF para oficios');
        }
        if (file.mimetype !== 'application/pdf') {
            throw new common_1.BadRequestException('Tipo MIME inválido. Solo se acepta application/pdf');
        }
    }
    validateCitas(file) {
        this._validateSpreadsheet(file, 'citas');
    }
    validateFuncionarios(file) {
        this._validateSpreadsheet(file, 'funcionarios');
    }
    _validateSpreadsheet(file, context) {
        if (!file) {
            throw new common_1.BadRequestException('No se ha proporcionado ningún archivo');
        }
        if (file.size > this.maxFileSize) {
            throw new common_1.BadRequestException(`El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`);
        }
        const allowedSpreadsheetExtensions = ['.xls', '.xlsx', '.csv'];
        const fileExtension = (0, path_1.extname)(file.originalname).toLowerCase();
        if (!allowedSpreadsheetExtensions.includes(fileExtension)) {
            throw new common_1.BadRequestException(`Tipo de archivo no permitido para ${context}. Solo se permiten archivos Excel (.xls, .xlsx) y CSV (.csv).`);
        }
        const allowedSpreadsheetMimeTypes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv',
            'application/csv',
            'text/plain',
        ];
        if (!allowedSpreadsheetMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException(`Formato de archivo inválido para ${context}. MIME type no permitido: ${file.mimetype}`);
        }
    }
    validateBoleta(file) {
        if (!file) {
            throw new common_1.BadRequestException('No se ha proporcionado ningún archivo');
        }
        if (file.size > this.maxFileSize) {
            throw new common_1.BadRequestException(`El archivo excede el tamaño máximo permitido de ${this.maxFileSize / 1024 / 1024}MB`);
        }
        const allowedBoletaExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
        const fileExtension = (0, path_1.extname)(file.originalname).toLowerCase();
        if (!allowedBoletaExtensions.includes(fileExtension)) {
            throw new common_1.BadRequestException(`Tipo de archivo no permitido para boletas. Solo se permiten imágenes (JPG, PNG) y PDF.`);
        }
        const allowedBoletaMimeTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'application/pdf',
        ];
        if (!allowedBoletaMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Formato de archivo inválido para boleta');
        }
    }
    generateFileName(originalName) {
        const fileExtension = (0, path_1.extname)(originalName).toLowerCase();
        return `${(0, crypto_1.randomUUID)()}${fileExtension}`;
    }
    sanitizeFilename(filename) {
        const segments = filename.replace(/\\/g, '/').split('/');
        const sanitized = segments
            .map((seg) => seg.replace(/\.\./g, '').replace(/[\\]/g, '').trim())
            .filter((seg) => seg.length > 0)
            .join('/');
        if (!sanitized) {
            throw new common_1.BadRequestException('Nombre de archivo inválido');
        }
        return sanitized;
    }
    async uploadFile(file, filename, folder) {
        try {
            const sanitizedFilename = this.sanitizeFilename(filename);
            const key = folder ? `${folder}/${sanitizedFilename}` : sanitizedFilename;
            await this.minioClient.putObject(this.bucketName, key, file.buffer, file.size, {
                'Content-Type': file.mimetype,
                'Original-Name': encodeURIComponent(file.originalname),
                'X-Amz-Acl': 'private',
            });
            return key;
        }
        catch (error) {
            throw new common_1.BadRequestException(`Error al subir el archivo: ${error.message}`);
        }
    }
    async fileExists(filename) {
        try {
            const sanitizedFilename = this.sanitizeFilename(filename);
            await this.minioClient.statObject(this.bucketName, sanitizedFilename);
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async getFileInfo(filename) {
        try {
            const sanitizedFilename = this.sanitizeFilename(filename);
            const stat = await this.minioClient.statObject(this.bucketName, sanitizedFilename);
            const originalNameEncoded = stat.metaData['original-name'] || sanitizedFilename;
            let originalName = originalNameEncoded;
            try {
                originalName = decodeURIComponent(originalNameEncoded);
            }
            catch (e) {
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
        }
        catch (error) {
            if (error.code === 'NotFound' || error.message?.includes('does not exist')) {
                throw new common_1.NotFoundException('Archivo no encontrado');
            }
            throw new common_1.NotFoundException(`Error al obtener información del archivo: ${error.message}`);
        }
    }
    async getFileBuffer(filename) {
        try {
            const sanitizedFilename = this.sanitizeFilename(filename);
            const chunks = [];
            const dataStream = await this.minioClient.getObject(this.bucketName, sanitizedFilename);
            return new Promise((resolve, reject) => {
                dataStream.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                dataStream.on('end', () => {
                    resolve(Buffer.concat(chunks));
                });
                dataStream.on('error', (err) => {
                    if (err?.code === 'NotFound' || err?.message?.includes('does not exist')) {
                        reject(new common_1.NotFoundException('Archivo no encontrado'));
                    }
                    else {
                        reject(new common_1.NotFoundException(`Error al obtener el archivo: ${err?.message || 'Error desconocido'}`));
                    }
                });
            });
        }
        catch (error) {
            if (error?.status === common_1.HttpStatus.NOT_FOUND || error instanceof common_1.NotFoundException) {
                throw error;
            }
            throw new common_1.NotFoundException(`Error al obtener el archivo: ${error?.message || 'Error desconocido'}`);
        }
    }
    async getFileStream(filename) {
        try {
            const sanitizedFilename = this.sanitizeFilename(filename);
            return await this.minioClient.getObject(this.bucketName, sanitizedFilename);
        }
        catch (error) {
            if (error?.code === 'NotFound' || error?.status === common_1.HttpStatus.NOT_FOUND) {
                throw new common_1.NotFoundException('Archivo no encontrado');
            }
            throw new common_1.NotFoundException(`Error al obtener el archivo: ${error?.message || 'Error desconocido'}`);
        }
    }
    async generatePresignedUrl(filename, expirySeconds = 60) {
        try {
            if (expirySeconds <= 0 || expirySeconds > 24 * 60 * 60) {
                throw new common_1.BadRequestException('El tiempo de expiración debe estar entre 1 segundo y 24 horas');
            }
            const sanitizedFilename = this.sanitizeFilename(filename);
            return await this.minioClient.presignedGetObject(this.bucketName, sanitizedFilename, expirySeconds);
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException) {
                throw error;
            }
            if (error?.code === 'NotFound') {
                throw new common_1.NotFoundException('Archivo no encontrado');
            }
            throw new common_1.NotFoundException(`Error al generar el enlace seguro: ${error?.message || 'Error desconocido'}`);
        }
    }
    getMimeType(filename) {
        const ext = (0, path_1.extname)(filename).toLowerCase();
        const mimeTypes = {
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
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
    hasSuspiciousDoubleExtension(filename) {
        const sanitizedName = filename.toLowerCase().replace(/\s+/g, '');
        if (this.blockedDoubleExtensions.some((ext) => sanitizedName.includes(`${ext}.`))) {
            return true;
        }
        const allowedPattern = new RegExp(`\\.(${this.allowedExtensions
            .map((ext) => ext.replace('.', ''))
            .join('|')})\\.(${this.allowedExtensions.map((ext) => ext.replace('.', '')).join('|')})$`);
        return allowedPattern.test(sanitizedName);
    }
};
exports.FilesService = FilesService;
exports.FilesService = FilesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], FilesService);
//# sourceMappingURL=files.service.js.map
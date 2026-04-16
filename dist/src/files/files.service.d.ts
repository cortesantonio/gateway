import { OnModuleInit } from '@nestjs/common';
export declare class FilesService implements OnModuleInit {
    private minioClient;
    private readonly bucketName;
    private readonly allowedMimeTypes;
    private readonly allowedExtensions;
    private readonly blockedDoubleExtensions;
    private readonly maxFileSize;
    constructor();
    onModuleInit(): Promise<void>;
    validateFile(file: Express.Multer.File): void;
    validateOficio(file: Express.Multer.File): void;
    validateCitas(file: Express.Multer.File): void;
    validateFuncionarios(file: Express.Multer.File): void;
    private _validateSpreadsheet;
    validateBoleta(file: Express.Multer.File): void;
    validateTicket(file: Express.Multer.File): void;
    generateFileName(originalName: string): string;
    private sanitizeFilename;
    uploadFile(file: Express.Multer.File, filename: string, folder?: string): Promise<string>;
    fileExists(filename: string): Promise<boolean>;
    getFileInfo(filename: string): Promise<{
        filename: string;
        size: number;
        contentType: any;
        originalName: any;
        lastModified: Date;
        etag: string;
    }>;
    getFileBuffer(filename: string): Promise<Buffer>;
    getFileStream(filename: string): Promise<NodeJS.ReadableStream>;
    generatePresignedUrl(filename: string, expirySeconds?: number): Promise<string>;
    getMimeType(filename: string): string;
    private hasSuspiciousDoubleExtension;
}

import type { Response } from 'express';
import { FilesService } from './files.service';
export declare class FilesController {
    private readonly filesService;
    constructor(filesService: FilesService);
    uploadFile(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    uploadBoleta(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    uploadOficio(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    uploadCitas(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    uploadCredenciales(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    uploadFuncionarios(file: Express.Multer.File): Promise<{
        success: boolean;
        message: string;
        data: {
            filename: string;
            originalname: string;
            size: number;
            mimetype: string;
            uploadedAt: string;
        };
    }>;
    processAppointments(file: Express.Multer.File, res: Response): Promise<void>;
    uploadTickets(files: Express.Multer.File[]): Promise<{
        success: boolean;
        message: string;
        data?: undefined;
    } | {
        success: boolean;
        message: string;
        data: any;
    }>;
    getBoleta(filename: string, res: Response): Promise<void>;
    getFileInfo(filename: string): Promise<{
        success: boolean;
        data: {
            filename: string;
            size: number;
            contentType: any;
            originalName: any;
            lastModified: Date;
            etag: string;
        };
    }>;
    getFileByFolder(folder: string, filename: string, res: Response): Promise<void>;
    getFile(filename: string, res: Response): Promise<void>;
}

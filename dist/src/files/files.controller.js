"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const files_service_1 = require("./files.service");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
let FilesController = class FilesController {
    filesService;
    constructor(filesService) {
        this.filesService = filesService;
    }
    async uploadFile(file) {
        this.filesService.validateFile(file);
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename);
        return {
            success: true,
            message: 'Archivo subido exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async uploadBoleta(file) {
        this.filesService.validateBoleta(file);
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename);
        return {
            success: true,
            message: 'Boleta subida exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async uploadOficio(file) {
        this.filesService.validateOficio(file);
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename, 'oficios');
        return {
            success: true,
            message: 'Oficio subido exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async uploadCitas(file) {
        this.filesService.validateCitas(file);
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename, 'citas');
        return {
            success: true,
            message: 'Archivo de citas subido exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async uploadCredenciales(file) {
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename, 'credenciales');
        return {
            success: true,
            message: 'Archivo de credenciales subido exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async uploadFuncionarios(file) {
        this.filesService.validateFuncionarios(file);
        const filename = this.filesService.generateFileName(file.originalname);
        const uploadedFilename = await this.filesService.uploadFile(file, filename, 'funcionarios');
        return {
            success: true,
            message: 'Archivo de funcionarios subido exitosamente',
            data: {
                filename: uploadedFilename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                uploadedAt: new Date().toISOString(),
            },
        };
    }
    async getBoleta(filename, res) {
        return this.getFile(filename, res);
    }
    async getFileInfo(filename) {
        const fileInfo = await this.filesService.getFileInfo(filename);
        return {
            success: true,
            data: fileInfo,
        };
    }
    async getFileByFolder(folder, filename, res) {
        return this.getFile(`${folder}/${filename}`, res);
    }
    async getFile(filename, res) {
        try {
            const fileBuffer = await this.filesService.getFileBuffer(filename);
            const fileInfo = await this.filesService.getFileInfo(filename);
            const mimeType = this.filesService.getMimeType(filename);
            const safeFilename = (fileInfo.originalName || fileInfo.filename)
                .replace(/[\r\n"]/g, '')
                .substring(0, 255);
            res.set({
                'Content-Type': fileInfo.contentType || mimeType,
                'Content-Disposition': `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
                'Content-Length': fileInfo.size.toString(),
            });
            res.send(fileBuffer);
        }
        catch (error) {
            if (error.status === common_1.HttpStatus.NOT_FOUND) {
                res.status(common_1.HttpStatus.NOT_FOUND).json({
                    success: false,
                    message: 'Archivo no encontrado',
                });
            }
            else {
                res.status(common_1.HttpStatus.INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error al obtener el archivo',
                });
            }
        }
    }
};
exports.FilesController = FilesController;
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        fileFilter: (req, file, cb) => {
            const ext = file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|gif|pdf|doc|docx)$/);
            if (!ext) {
                return cb(new Error('Solo se permiten archivos de imagen y documentos'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Post)('boletas'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        fileFilter: (req, file, cb) => {
            const ext = file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|pdf)$/);
            if (!ext) {
                return cb(new Error('Solo se permiten boletas en formato imagen (JPG, PNG) o PDF'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadBoleta", null);
__decorate([
    (0, common_1.Post)('oficios'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        fileFilter: (req, file, cb) => {
            const ext = file.originalname.toLowerCase().match(/\.pdf$/);
            if (!ext) {
                return cb(new Error('Solo se permiten archivos PDF para oficios'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadOficio", null);
__decorate([
    (0, common_1.Post)('citas'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        fileFilter: (req, file, cb) => {
            const ext = file.originalname.toLowerCase().match(/\.(xls|xlsx|csv)$/);
            if (!ext) {
                return cb(new Error('Solo se permiten archivos Excel (.xls, .xlsx) o CSV (.csv) para citas'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadCitas", null);
__decorate([
    (0, common_1.Post)('credenciales'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadCredenciales", null);
__decorate([
    (0, common_1.Post)('funcionarios'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.memoryStorage)(),
        fileFilter: (req, file, cb) => {
            const ext = file.originalname.toLowerCase().match(/\.(xls|xlsx|csv)$/);
            if (!ext) {
                return cb(new Error('Solo se permiten archivos Excel (.xls, .xlsx) o CSV (.csv) para funcionarios'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadFuncionarios", null);
__decorate([
    (0, common_1.Get)('boletas/:filename'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "getBoleta", null);
__decorate([
    (0, common_1.Get)(':filename/info'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __param(0, (0, common_1.Param)('filename')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "getFileInfo", null);
__decorate([
    (0, common_1.Get)(':folder/:filename'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __param(0, (0, common_1.Param)('folder')),
    __param(1, (0, common_1.Param)('filename')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "getFileByFolder", null);
__decorate([
    (0, common_1.Get)(':filename'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "getFile", null);
exports.FilesController = FilesController = __decorate([
    (0, common_1.Controller)('files'),
    __metadata("design:paramtypes", [files_service_1.FilesService])
], FilesController);
//# sourceMappingURL=files.controller.js.map
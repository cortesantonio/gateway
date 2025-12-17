import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        // Validación básica en el interceptor
        const ext = file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|gif|pdf|doc|docx)$/);
        if (!ext) {
          return cb(
            new Error('Solo se permiten archivos de imagen y documentos'),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    // Validación adicional usando el servicio
    this.filesService.validateFile(file);

    // Generar nombre único para el archivo
    const filename = this.filesService.generateFileName(file.originalname);
    
    // Subir archivo a MinIO
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

  @Get(':filename/info')
  @UseGuards(SupabaseAuthGuard)
  async getFileInfo(@Param('filename') filename: string) {
    const fileInfo = await this.filesService.getFileInfo(filename);
    return {
      success: true,
      data: fileInfo,
    };
  }

  @Get(':filename')
  @UseGuards(SupabaseAuthGuard)
  async getFile(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const fileBuffer = await this.filesService.getFileBuffer(filename);
      const fileInfo = await this.filesService.getFileInfo(filename);
      const mimeType = this.filesService.getMimeType(filename);

      // Sanitizar el nombre del archivo para prevenir header injection
      const safeFilename = (fileInfo.originalName || fileInfo.filename)
        .replace(/[\r\n"]/g, '')
        .substring(0, 255);

      res.set({
        'Content-Type': fileInfo.contentType || mimeType,
        'Content-Disposition': `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
        'Content-Length': fileInfo.size.toString(),
      });

      res.send(fileBuffer);
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Archivo no encontrado',
        });
      } else {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Error al obtener el archivo',
        });
      }
    }
  }
}

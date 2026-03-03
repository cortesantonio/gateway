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
  constructor(private readonly filesService: FilesService) { }

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

  @Post('boletas')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        // Validación básica en el interceptor para boletas
        const ext = file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|pdf)$/);
        if (!ext) {
          return cb(
            new Error('Solo se permiten boletas en formato imagen (JPG, PNG) o PDF'),
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
  async uploadBoleta(@UploadedFile() file: Express.Multer.File) {
    // Validación estricta usando el servicio
    this.filesService.validateBoleta(file);

    // Generar nombre único para la boleta
    const filename = this.filesService.generateFileName(file.originalname);

    // Subir archivo a MinIO (reutilizamos la lógica de subida ya que el bucket es el mismo)
    // Si se requiriera un bucket diferente, habría que modificar el servicio
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

  @Post('oficios')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        const ext = file.originalname.toLowerCase().match(/\.pdf$/);
        if (!ext) {
          return cb(
            new Error('Solo se permiten archivos PDF para oficios'),
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
  async uploadOficio(@UploadedFile() file: Express.Multer.File) {
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

  @Post('citas')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        const ext = file.originalname.toLowerCase().match(/\.(xls|xlsx|csv)$/);
        if (!ext) {
          return cb(
            new Error('Solo se permiten archivos Excel (.xls, .xlsx) o CSV (.csv) para citas'),
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
  async uploadCitas(@UploadedFile() file: Express.Multer.File) {
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

  @Post('funcionarios')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        const ext = file.originalname.toLowerCase().match(/\.(xls|xlsx|csv)$/);
        if (!ext) {
          return cb(
            new Error('Solo se permiten archivos Excel (.xls, .xlsx) o CSV (.csv) para funcionarios'),
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
  async uploadFuncionarios(@UploadedFile() file: Express.Multer.File) {
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

  @Get('boletas/:filename')
  @UseGuards(SupabaseAuthGuard)
  async getBoleta(@Param('filename') filename: string, @Res() res: Response) {
    // Reutilizamos la lógica de getFile pero protegido con el guard y en una ruta específica
    return this.getFile(filename, res);
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

  // Ruta para archivos con subcarpeta: GET /files/oficios/uuid.pdf, /files/citas/uuid.xlsx, etc.
  @Get(':folder/:filename')
  @UseGuards(SupabaseAuthGuard)
  async getFileByFolder(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    return this.getFile(`${folder}/${filename}`, res);
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

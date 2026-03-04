import { Controller, Post, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('users')
@UseGuards(SupabaseAuthGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post('admin-create')
    async createAuthUser(@Body() body: { email: string; password?: string }) {
        if (!body.email || !body.password) {
            throw new HttpException('Email y Password son requeridos', HttpStatus.BAD_REQUEST);
        }

        // Aquí podrías agregar validación extra de roles si tienes forma de verificar el rol del usuario que hace la petición
        // El SupabaseAuthGuard solo verifica que el token sea válido.

        return await this.usersService.createAuthUser(body.email, body.password);
    }

    @Post('admin-change-password')
    async changeUserPassword(@Body() body: { userId: string; newPassword: string }) {
        if (!body.userId || !body.newPassword) {
            throw new HttpException('userId y newPassword son requeridos', HttpStatus.BAD_REQUEST);
        }

        if (body.newPassword.length < 6) {
            throw new HttpException('La contraseña debe tener al menos 6 caracteres', HttpStatus.BAD_REQUEST);
        }

        return await this.usersService.changeUserPassword(body.userId, body.newPassword);
    }
}

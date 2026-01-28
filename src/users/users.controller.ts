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
}

import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../auth/supabase.service';

@Injectable()
export class UsersService {
    constructor(private readonly supabaseService: SupabaseService) { }

    async createAuthUser(email: string, password: string) {
        const adminClient = this.supabaseService.getAdminClient();

        const { data, error } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (error) {
            console.error('Error creando usuario en Supabase Auth:', error);
            throw new BadRequestException(error.message);
        }

        return data.user;
    }
}

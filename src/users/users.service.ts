import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../auth/supabase.service';
import { User } from '@supabase/supabase-js';

@Injectable()
export class UsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async changeUserPassword(userId: string, newPassword: string) {
    const adminClient = this.supabaseService.getAdminClient();

    const { data, error } = await adminClient.auth.admin.updateUserById(
      userId,
      {
        password: newPassword,
      },
    );

    if (error) {
      console.error('Error cambiando contraseña en Supabase Auth:', error);
      throw new BadRequestException(error.message);
    }

    return data.user;
  }

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

  async getSecurityInfo() {
    const adminClient = this.supabaseService.getAdminClient();

    let allUsers: User[] = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        console.error('Error al listar usuarios en auth:', error);
        throw new BadRequestException(error.message);
      }

      if (!data || !data.users || data.users.length === 0) {
        break;
      }

      allUsers = allUsers.concat(data.users);

      if (data.users.length < perPage) {
        break;
      }

      page++;
    }

    // Obtener detalles completos de cada usuario en paralelo para recuperar su arreglo de factores MFA
    const detailedUsers = await Promise.all(
      allUsers.map(async (user) => {
        try {
          const { data, error } = await adminClient.auth.admin.getUserById(
            user.id,
          );
          if (error || !data || !data.user) {
            return user;
          }
          return data.user;
        } catch (e) {
          console.error(`Error obteniendo detalles del usuario ${user.id}:`, e);
          return user;
        }
      }),
    );

    // Mapeamos para retornar la info de seguridad necesaria
    return detailedUsers.map((user) => {
      const factors = (
        user as unknown as { factors?: Array<{ status: string }> }
      ).factors;
      const mfa_enabled = (factors || []).some((f) => f.status === 'verified');
      return {
        id: user.id,
        last_sign_in_at: user.last_sign_in_at ?? null,
        mfa_enabled,
      };
    });
  }
}

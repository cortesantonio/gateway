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

    // Consultamos los factores MFA de los usuarios en lotes paralelos para evitar cuello de botella
    const BATCH_SIZE = 15;
    const mfaStatusMap = new Map<string, boolean>();

    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
      const batch = allUsers.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (u) => {
          try {
            const { data } = await adminClient.auth.admin.mfa.listFactors({
              userId: u.id,
            });
            const hasVerified = (data?.factors || []).some(
              (f) => f.status === 'verified',
            );
            mfaStatusMap.set(u.id, hasVerified);
          } catch (err) {
            console.error(
              `Error al verificar factores MFA para el usuario ${u.id}:`,
              err,
            );
            mfaStatusMap.set(u.id, false);
          }
        }),
      );
    }

    return allUsers.map((user) => ({
      id: user.id,
      last_sign_in_at: user.last_sign_in_at ?? null,
      mfa_enabled: mfaStatusMap.get(user.id) ?? false,
    }));
  }

  async disableUserMfa(userId: string) {
    const adminClient = this.supabaseService.getAdminClient();

    const { data, error } = await adminClient.auth.admin.mfa.listFactors({
      userId,
    });

    if (error) {
      console.error('Error obteniendo factores MFA del usuario:', error);
      throw new BadRequestException(error.message);
    }

    if (!data || !data.factors) return { success: true };

    for (const factor of data.factors) {
      const { error: deleteError } =
        await adminClient.auth.admin.mfa.deleteFactor({
          userId,
          id: factor.id,
        });
      if (deleteError) {
        console.error(`Error eliminando factor MFA ${factor.id}:`, deleteError);
        throw new BadRequestException(deleteError.message);
      }
    }

    return { success: true };
  }

  async deleteAuthUser(userId: string) {
    const adminClient = this.supabaseService.getAdminClient();

    // 1. Eliminar de la tabla pública `user` primeramente (por relaciones)
    const { error: dbError } = await adminClient
      .from('user')
      .delete()
      .eq('id', userId);

    if (dbError) {
      console.warn(
        `Aviso o error al eliminar en tabla user: ${dbError.message}`,
      );
    }

    // 2. Eliminar de Supabase Auth
    const { error: authError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (authError) {
      console.error(
        `Error eliminando usuario ${userId} de Supabase Auth:`,
        authError,
      );
      throw new BadRequestException(authError.message);
    }

    return { success: true };
  }
}

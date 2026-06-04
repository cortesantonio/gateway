import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private adminSupabase: SupabaseClient | null = null;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY son requeridas',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseAnonKey);

    if (supabaseServiceRoleKey) {
      this.adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }
  }

  /**
   * Valida un token JWT de Supabase Auth
   * @param token Token JWT a validar
   * @returns Información del usuario si el token es válido
   */
  async validateToken(token: string) {
    try {
      // Extraer el token del header Bearer si viene con "Bearer"
      const cleanToken = token.startsWith('Bearer ')
        ? token.substring(7)
        : token;

      // Verificar el token con Supabase
      const {
        data: { user },
        error,
      } = await this.supabase.auth.getUser(cleanToken);

      if (error || !user) {
        return null;
      }

      return user;
    } catch (error) {
      return null;
    }
  }

  /**
   * Obtiene el cliente de Supabase (Anon)
   */
  getClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Obtiene el cliente de Supabase con Service Role (Admin)
   */
  getAdminClient(): SupabaseClient {
    if (!this.adminSupabase) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada');
    }
    return this.adminSupabase;
  }
}

import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY son requeridas',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
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
   * Obtiene el cliente de Supabase
   */
  getClient(): SupabaseClient {
    return this.supabase;
  }
}


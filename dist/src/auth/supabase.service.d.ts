import { SupabaseClient } from '@supabase/supabase-js';
export declare class SupabaseService {
    private supabase;
    private adminSupabase;
    constructor();
    validateToken(token: string): Promise<import("@supabase/supabase-js").AuthUser | null>;
    getClient(): SupabaseClient;
    getAdminClient(): SupabaseClient;
}

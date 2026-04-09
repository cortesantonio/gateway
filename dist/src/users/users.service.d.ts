import { SupabaseService } from '../auth/supabase.service';
export declare class UsersService {
    private readonly supabaseService;
    constructor(supabaseService: SupabaseService);
    changeUserPassword(userId: string, newPassword: string): Promise<import("@supabase/auth-js").User>;
    createAuthUser(email: string, password: string): Promise<import("@supabase/auth-js").User>;
}

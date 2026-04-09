import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    createAuthUser(body: {
        email: string;
        password?: string;
    }): Promise<import("@supabase/auth-js").User>;
    changeUserPassword(body: {
        userId: string;
        newPassword: string;
    }): Promise<import("@supabase/auth-js").User>;
}

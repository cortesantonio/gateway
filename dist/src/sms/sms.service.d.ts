import { SupabaseService } from '../auth/supabase.service';
export declare class SmsService {
    private readonly supabaseService;
    private readonly logger;
    constructor(supabaseService: SupabaseService);
    sendSms(number: string, message: string): Promise<void>;
    CheckAnswer(): Promise<string>;
    processSmsAnswers(): Promise<void>;
    parseSmsOutput(output: string): {
        id: number | null;
        row: number | null;
        address: string | null;
        body: string | null;
        type: number | null;
        date: number | null;
    }[];
    private isDeviceConnected;
    private executeCommand;
    private sleep;
}

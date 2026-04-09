import { MailService } from './mail.service';
interface MailBody {
    to: string;
    bcc?: string;
    subject: string;
    html?: string;
    text?: string;
    template?: {
        title: string;
        subtitle?: string;
        message: string;
        actionUrl?: string;
        actionText?: string;
        details?: string;
        actionInstruction?: string;
    };
    attachments?: any[];
}
export declare class MailController {
    private readonly mailService;
    constructor(mailService: MailService);
    sendMail(body: MailBody): Promise<{
        success: boolean;
        message: string;
        messageId: any;
    }>;
}
export {};

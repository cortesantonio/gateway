export declare class MailService {
    private transporter;
    private readonly logger;
    constructor();
    verifyConnection(): Promise<void>;
    sendMail(to: string, subject: string, html: string, text?: string, bcc?: string, attachments?: any[]): Promise<any>;
    getBasicTemplate(title: string, subtitle: string, message: string, actionUrl?: string, actionText?: string, detailsHtml?: string, actionInstruction?: string): string;
}

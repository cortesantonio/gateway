import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../auth/supabase.service';

@Processor('mass-mail-queue', {
    concurrency: 1, // Procesamiento secuencial para mayor seguridad anti-spam
    limiter: {
        max: 1,
        duration: 2000, // Estricto: 1 correo cada 2 segundos
    }
})
export class MassMailProcessor extends WorkerHost {
    private readonly logger = new Logger(MassMailProcessor.name);

    constructor(
        private readonly mailService: MailService,
        private readonly supabaseService: SupabaseService,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        const { logId, recipient, subject, body, vars } = job.data;
        const client = this.supabaseService.getClient();

        this.logger.log(`Processing email for ${recipient} (Job ID: ${job.id})`);

        // Helper to replace variables
        const replaceVars = (text: string, variables: Record<string, string>) => {
            let processedText = text;
            Object.entries(variables).forEach(([key, value]) => {
                const regex = new RegExp(`{{${key}}}`, 'g');
                processedText = processedText.replace(regex, value || '');
            });
            return processedText;
        };

        const finalSubject = replaceVars(subject, vars || {});
        const finalBody = replaceVars(body, vars || {});

        try {
            // Send email with processed template
            await this.mailService.sendMail(recipient, finalSubject, finalBody);

            // Update status to sent
            await client
                .from('email_logs')
                .update({
                    status: 'sent',
                    sent_at: new Date(),
                    retry_count: job.attemptsMade
                })
                .eq('id', logId);

            return { success: true };
        } catch (error) {
            this.logger.error(`Failed to send email to ${recipient}`, error.stack);

            // Update status to failed
            const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);
            
            await client
                .from('email_logs')
                .update({
                    status: isFinalAttempt ? 'failed' : 'pending',
                    error_message: error.message,
                    retry_count: job.attemptsMade
                })
                .eq('id', logId);

            throw error;
        }
    }
}

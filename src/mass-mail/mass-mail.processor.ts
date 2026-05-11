import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../auth/supabase.service';

@Processor('mass-mail-queue', {
    concurrency: 1,
    lockDuration: 300000, // 5 minutos para evitar que Bull piense que el proceso falló durante el delay
    lockRenewTime: 60000, // Renovar cada minuto
    limiter: {
        max: 1,
        duration: 2000,
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

    private isWorkingHours(): boolean {
        const now = new Date();
        const day = now.getDay(); // 0: Sunday, 1: Monday, ..., 6: Saturday
        const hour = now.getHours();

        // Lunes a Viernes, de 8:00 a 18:00
        const isWeekday = day >= 1 && day <= 5;
        const isWorkingHour = hour >= 8 && hour < 18;

        return isWeekday && isWorkingHour;
    }

    private async waitForWorkingHours(job: Job) {
        if (this.isWorkingHours()) return;

        this.logger.log(`Outside working hours. Pausing processing for Job ${job.id}...`);

        while (!this.isWorkingHours()) {
            // Esperar 1 minuto antes de volver a verificar
            await new Promise(resolve => setTimeout(resolve, 60000));
            
            // Notificar progreso para mantener vivo el lock
            await job.updateProgress(0);
            
            const now = new Date();
            if (now.getMinutes() % 15 === 0) { // Loguear cada 15 min para no saturar
                this.logger.log(`Still outside working hours. Waiting for next window (Mon-Fri 08:00-18:00)...`);
            }
        }

        this.logger.log('Working hours reached. Resuming processing...');
    }

    async process(job: Job<any, any, string>): Promise<any> {
        // Verificar jornada laboral antes de procesar
        await this.waitForWorkingHours(job);

        const { logId, recipient, subject, body, vars } = job.data;
        const client = this.supabaseService.getClient();

        this.logger.log(`Processing email for ${recipient} (Job ID: ${job.id})`);

        // Anti-spam: Random delay between 30 seconds and 2 minutes
        const minDelay = 30000;
        const maxDelay = 120000;
        const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        
        this.logger.log(`Waiting ${Math.round(randomDelay / 1000)}s before sending to ${recipient} (Zimbra Rate-limit protection)`);
        await new Promise(resolve => setTimeout(resolve, randomDelay));

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

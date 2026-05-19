import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
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
  },
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

    this.logger.log(
      `Outside working hours. Pausing processing for Job ${job.id}...`,
    );

    while (!this.isWorkingHours()) {
      await job.updateProgress({
        status: 'paused_working_hours',
        message: 'Esperando ventana laboral (Lun-Vie 08:00-18:00)',
      });
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }

    this.logger.log('Working hours reached. Resuming processing...');
  }

  async process(job: Job<any, any, string>): Promise<any> {
    await this.waitForWorkingHours(job);

    const { logId, recipient, subject, body, vars } = job.data;
    const client = this.supabaseService.getClient();

    await job.updateProgress({
      status: 'processing',
      message: 'Preparando envío',
    });

    this.logger.log(`Processing email for ${recipient} (Job ID: ${job.id})`);

    // Paso 5: Optimización del Anti-Spam Delay
    const minDelay = 30000; // 30s
    const maxDelay = 120000; // 120s
    const randomDelay =
      Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    const delayInSecs = Math.round(randomDelay / 1000);

    this.logger.log(
      `Waiting ${delayInSecs}s before sending to ${recipient} (Zimbra Rate-limit protection)`,
    );
    await job.updateProgress({
      status: 'anti_spam_delay',
      message: `Pausa anti-spam de ${delayInSecs}s`,
    });
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    // Paso 2: Generación segura de variables (Fallback y limpieza)
    const replaceVars = (text: string, variables: Record<string, string>) => {
      let processedText = text;
      Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        // Fallback a string vacío si es null o undefined
        processedText = processedText.replace(regex, value ?? '');
      });
      // Limpiar variables remanentes no reemplazadas para no romper el diseño
      return processedText.replace(/{{[^}]+}}/g, '');
    };

    const finalSubject = replaceVars(subject, vars || {});
    const finalBody = replaceVars(body, vars || {});

    try {
      // Paso 3: Progreso en tiempo real
      await job.updateProgress({
        status: 'sending',
        message: 'Enviando correo',
      });

      // Send email with processed template
      await this.mailService.sendMail(recipient, finalSubject, finalBody);

      // Update status to sent
      await client
        .from('email_logs')
        .update({
          status: 'sent',
          sent_at: new Date(),
          retry_count: job.attemptsMade,
        })
        .eq('id', logId);

      await job.updateProgress({
        status: 'completed',
        message: 'Enviado correctamente',
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${recipient}: ${error.message}`,
        error.stack,
      );

      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);

      // Paso 4: Manejo de Errores Irrecuperables
      const isUnrecoverable =
        error.message.includes('Invalid login') ||
        error.message.includes('No recipients defined') ||
        error.message.includes('Rejected');

      await client
        .from('email_logs')
        .update({
          status: isFinalAttempt || isUnrecoverable ? 'failed' : 'pending',
          error_message: error.message,
          retry_count: job.attemptsMade,
        })
        .eq('id', logId);

      if (isUnrecoverable) {
        this.logger.error(
          `Unrecoverable error for ${recipient}. Cancelling retries.`,
        );
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }
  }
}

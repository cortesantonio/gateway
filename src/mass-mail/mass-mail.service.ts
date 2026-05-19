import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { SupabaseService } from '../auth/supabase.service';
import { SendMassMailDto } from './dto/send-mass-mail.dto';

@Injectable()
export class MassMailService {
  private readonly logger = new Logger(MassMailService.name);

  constructor(
    @InjectQueue('mass-mail-queue') private readonly mailQueue: Queue,
    private readonly supabaseService: SupabaseService,
  ) {}

  // Paso 1: Validación de formato de correo
  private isValidEmail(email: string): boolean {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  async enqueueEmails(dto: SendMassMailDto) {
    const { recipients, subject, body, groupId: providedGroupId } = dto;
    const client = this.supabaseService.getClient();

    // Filtrar correos inválidos
    const validRecipients = recipients.filter(
      (r) => r.email && this.isValidEmail(r.email.trim()),
    );

    if (validRecipients.length === 0) {
      throw new BadRequestException(
        'No hay destinatarios válidos para procesar.',
      );
    }

    // Generate a unique group_id for this batch if not provided
    const groupId = providedGroupId || crypto.randomUUID();

    this.logger.log(
      `Enqueuing ${validRecipients.length} valid emails for group: ${groupId} (filtered ${recipients.length - validRecipients.length} invalid)`,
    );

    // Prepare logs for DB
    const logs = validRecipients.map((r) => ({
      recipient: r.email.trim().toLowerCase(),
      subject,
      body,
      group_id: groupId,
      status: 'pending',
      metadata: { vars: r.vars || {} },
      queued_at: new Date(),
    }));

    // Insert into database in batches
    const { data, error } = await client
      .from('email_logs')
      .insert(logs)
      .select('id, recipient, metadata');

    if (error) {
      this.logger.error('Error creating email logs', error);
      throw error;
    }

    // Add to Redis queue
    const jobs = data.map((log) => ({
      name: 'send-email',
      data: {
        logId: log.id,
        recipient: log.recipient,
        subject,
        body,
        vars: log.metadata?.vars || {},
      },
      opts: {
        attempts: 3, // Reducido a 3 para no sobrecargar si hay fallos persistentes
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }));

    await this.mailQueue.addBulk(jobs);

    return {
      count: validRecipients.length,
      groupId,
      invalidCount: recipients.length - validRecipients.length,
    };
  }

  async getHistory(page: number = 1, limit: number = 10) {
    const client = this.supabaseService.getClient();
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await client
      .from('email_logs')
      .select('*', { count: 'exact' })
      .order('queued_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return {
      data,
      total: count,
      page,
      limit,
    };
  }

  async getQueueStats() {
    const client = this.supabaseService.getClient();

    // 1. Redis queue counts (real-time queue state)
    const [waiting, active, delayed, failedQueue] = await Promise.all([
      this.mailQueue.getWaitingCount(),
      this.mailQueue.getActiveCount(),
      this.mailQueue.getDelayedCount(),
      this.mailQueue.getFailedCount(),
    ]);

    // 2. DB counts (source of truth for completed/failed/pending/bounced)
    const [pendingRes, sentRes, failedRes, bouncedRes] = await Promise.all([
      client
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      client
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent'),
      client
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      client
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'bounced'),
    ]);

    const dbCounts = {
      pending: pendingRes.count ?? 0,
      sent: sentRes.count ?? 0,
      failed: failedRes.count ?? 0,
      bounced: bouncedRes.count ?? 0,
      total:
        (pendingRes.count ?? 0) +
        (sentRes.count ?? 0) +
        (failedRes.count ?? 0) +
        (bouncedRes.count ?? 0),
    };

    // 3. Get the latest batch info (most recent group)
    const { data: latestBatch } = await client
      .from('email_logs')
      .select('group_id, queued_at')
      .order('queued_at', { ascending: false })
      .limit(1)
      .single();

    let batchInfo: {
      groupId: string;
      queuedAt: string;
      total: number;
      sent: number;
      failed: number;
      bounced: number;
      pending: number;
      progress: number;
    } | null = null;
    if (latestBatch) {
      const { data: batchStats } = await client
        .from('email_logs')
        .select('status')
        .eq('group_id', latestBatch.group_id);

      if (batchStats) {
        const batchTotal = batchStats.length;
        const batchSent = batchStats.filter((r) => r.status === 'sent').length;
        const batchFailed = batchStats.filter(
          (r) => r.status === 'failed',
        ).length;
        const batchBounced = batchStats.filter(
          (r) => r.status === 'bounced',
        ).length;
        const batchPending = batchStats.filter(
          (r) => r.status === 'pending',
        ).length;

        batchInfo = {
          groupId: latestBatch.group_id,
          queuedAt: latestBatch.queued_at,
          total: batchTotal,
          sent: batchSent,
          failed: batchFailed,
          bounced: batchBounced,
          pending: batchPending,
          progress:
            batchTotal > 0
              ? Math.round(
                  ((batchSent + batchBounced + batchFailed) / batchTotal) * 100,
                )
              : 0,
        };
      }
    }

    // 4. Get active/next jobs from Redis queue
    const activeJobs = await this.mailQueue.getActive(0, 4);
    const waitingJobs = await this.mailQueue.getWaiting(0, 4);

    const activeDetails = activeJobs.map((j) => ({
      id: j.id,
      recipient: j.data?.recipient,
      progress: j.progress,
      timestamp: j.timestamp,
      attemptsMade: j.attemptsMade,
    }));

    const nextUp = waitingJobs.map((j) => ({
      id: j.id,
      recipient: j.data?.recipient,
    }));

    // 5. Estimated time remaining (avg 75s per email — midpoint of 30–120s delay)
    const remainingInQueue = waiting + delayed;
    const estimatedSecondsRemaining = remainingInQueue * 75;

    return {
      // Redis real-time
      queue: { waiting, active, delayed, failed: failedQueue },
      // DB ground truth
      db: dbCounts,
      // Latest batch progress
      batch: batchInfo,
      // Active job details
      activeJobs: activeDetails,
      nextUp,
      // ETA
      estimatedSecondsRemaining,
      // Derived
      isProcessing: active > 0 || waiting > 0 || delayed > 0,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
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
    ) { }

    async enqueueEmails(dto: SendMassMailDto) {
        const { recipients, subject, body, groupId: providedGroupId } = dto;
        const client = this.supabaseService.getClient();
        
        // Generate a unique group_id for this batch if not provided
        const groupId = providedGroupId || crypto.randomUUID();

        this.logger.log(`Enqueuing ${recipients.length} emails for group: ${groupId}`);

        // Prepare logs for DB
        const logs = recipients.map(r => ({
            recipient: r.email,
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
        const jobs = data.map(log => ({
            name: 'send-email',
            data: {
                logId: log.id,
                recipient: log.recipient,
                subject,
                body,
                vars: (log.metadata as any)?.vars || {},
            },
            opts: {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            }
        }));

        await this.mailQueue.addBulk(jobs);

        return {
            count: recipients.length,
            groupId,
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
            limit
        };
    }

    async getQueueStats() {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            this.mailQueue.getWaitingCount(),
            this.mailQueue.getActiveCount(),
            this.mailQueue.getCompletedCount(),
            this.mailQueue.getFailedCount(),
            this.mailQueue.getDelayedCount(),
        ]);

        return {
            waiting,
            active,
            completed,
            failed,
            delayed,
            total: waiting + active + delayed
        };
    }
}

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { SupabaseService } from '../auth/supabase.service';

/**
 * BounceCheckerService — Polls the notificaciones@saludcurico.cl IMAP inbox
 * for DSN (Delivery Status Notification) bounce emails from Zimbra/PMG.
 *
 * Zimbra bounce structure (multipart/report):
 *   Part 1: text/plain — Human-readable notification with "<email>: host ... said: 550 ..."
 *   Part 2: message/delivery-status — Structured DSN with Final-Recipient, Diagnostic-Code, etc.
 *   Part 3: text/rfc822-headers — Original message headers
 *
 * When a bounce is detected, it:
 * 1. Extracts the failed recipient from Part 1 or Part 2.
 * 2. Extracts the error reason from the DSN diagnostic code.
 * 3. Matches the recipient against recent `email_logs` entries with status 'sent'.
 * 4. Updates the status to 'bounced' with the error message.
 * 5. Marks the bounce email as read to prevent reprocessing.
 */
@Injectable()
export class BounceCheckerService implements OnModuleDestroy {
  private readonly logger = new Logger(BounceCheckerService.name);
  private isProcessing = false;

  constructor(private readonly supabaseService: SupabaseService) {}

  onModuleDestroy() {
    this.logger.log('BounceCheckerService shutting down.');
  }

  /**
   * Run every 5 minutes.
   * Checks INBOX for unread bounce emails from "mailer-daemon" or "postmaster".
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkForBounces() {
    if (this.isProcessing) {
      this.logger.debug('Bounce check already in progress, skipping...');
      return;
    }

    this.isProcessing = true;

    let client: ImapFlow | null = null;

    try {
      client = new ImapFlow({
        host: process.env.MAIL_HOST || 'mail.saludcurico.cl',
        port: 993,
        secure: true,
        auth: {
          user: process.env.MAIL_USER || '',
          pass: process.env.MAIL_PASSWORD || '',
        },
        logger: false,
        tls: {
          rejectUnauthorized: false,
        },
      });

      await client.connect();
      this.logger.debug('Connected to IMAP for bounce checking.');

      const lock = await client.getMailboxLock('INBOX');

      try {
        // Search for unseen messages from mailer-daemon or postmaster
        const messages = await client.search({
          seen: false,
          or: [
            { from: 'mailer-daemon' },
            { from: 'postmaster' },
            { from: 'MAILER-DAEMON' },
          ],
        });

        if (!messages || messages.length === 0) {
          this.logger.debug('No new bounce messages found.');
          return;
        }

        this.logger.log(
          `Found ${messages.length} potential bounce message(s).`,
        );

        let processed = 0;

        for (const uid of messages) {
          try {
            const msg = (await client.fetchOne(
              uid,
              { source: true },
              { uid: true },
            )) as any;

            if (!msg || !msg.source) continue;

            const parsed = await simpleParser(msg.source as Buffer);
            const bounceResult = this.parseBounceEmail(parsed);

            if (bounceResult) {
              const updated = await this.updateEmailLog(
                bounceResult.failedRecipient,
                bounceResult.errorMessage,
              );

              if (updated) {
                processed++;
                this.logger.log(
                  `✓ Bounce processed: ${bounceResult.failedRecipient} → "${bounceResult.errorMessage.substring(0, 100)}"`,
                );
              } else {
                this.logger.warn(
                  `Bounce detected for ${bounceResult.failedRecipient} but no matching 'sent' log found.`,
                );
              }
            }

            // Mark as seen so we don't reprocess
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          } catch (msgError) {
            this.logger.error(
              `Error processing bounce message UID ${uid}:`,
              msgError.message,
            );
          }
        }

        this.logger.log(
          `Bounce check complete: ${processed} of ${messages.length} messages resulted in status updates.`,
        );
      } finally {
        lock.release();
      }
    } catch (error) {
      this.logger.error('Error during bounce check:', error.message);
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // Ignore logout errors
        }
      }
      this.isProcessing = false;
    }
  }

  /**
   * Parses a bounce/DSN email to extract the failed recipient and error.
   *
   * Handles the Zimbra/PMG multipart/report format:
   *   - text/plain body: contains "<email>: host ... said: 550-5.1.1 ..."
   *   - message/delivery-status attachment: contains "Final-Recipient: rfc822; email"
   *     and "Diagnostic-Code: smtp; 550-5.1.1 ..."
   */
  private parseBounceEmail(
    parsed: any,
  ): { failedRecipient: string; errorMessage: string } | null {
    const textBody = parsed.text || '';
    const subject = parsed.subject || '';

    // --- Step 1: Verify this is actually a bounce ---
    const bounceIndicators = [
      'undelivered mail returned to sender',
      'mail delivery failed',
      'delivery status notification',
      'message could not be delivered',
      'returned mail',
      'delivery failure',
      'undeliverable',
    ];

    const subjectLower = subject.toLowerCase();
    const bodyLower = textBody.toLowerCase();

    const isBounce = bounceIndicators.some(
      (ind) => subjectLower.includes(ind) || bodyLower.includes(ind),
    );

    if (!isBounce) return null;

    // --- Step 2: Build combined text from all MIME parts ---
    // mailparser puts the DSN delivery-status part in attachments as text content
    let dsnText = '';
    if (parsed.attachments && Array.isArray(parsed.attachments)) {
      for (const att of parsed.attachments) {
        // The delivery-status part has contentType 'message/delivery-status'
        // and the headers part has 'text/rfc822-headers'
        const ct = (att.contentType || '').toLowerCase();
        if (ct.includes('delivery-status') || ct.includes('rfc822')) {
          // Extract text content from the attachment buffer
          if (att.content && Buffer.isBuffer(att.content)) {
            dsnText += '\n' + att.content.toString('utf-8');
          } else if (typeof att.content === 'string') {
            dsnText += '\n' + att.content;
          }
        }
      }
    }

    // Combined searchable text: body + DSN parts
    const fullText = textBody + '\n' + dsnText;

    // --- Step 3: Extract the failed recipient email ---
    let failedRecipient: string | null = null;

    // Priority 1: Final-Recipient from DSN part (most reliable)
    // Format: "Final-Recipient: rfc822; ESTREBANMORE1996@gmail.com"
    const finalRecipientMatch = fullText.match(
      /Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i,
    );
    if (finalRecipientMatch) {
      failedRecipient = finalRecipientMatch[1].toLowerCase().trim();
    }

    // Priority 2: Original-Recipient from DSN part
    if (!failedRecipient) {
      const origRecipientMatch = fullText.match(
        /Original-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i,
      );
      if (origRecipientMatch) {
        failedRecipient = origRecipientMatch[1].toLowerCase().trim();
      }
    }

    // Priority 3: <email>: host ... said: pattern from text/plain body
    if (!failedRecipient) {
      const angleMatch = textBody.match(/<([^>]+@[^>]+)>:\s*host/i);
      if (angleMatch) {
        failedRecipient = angleMatch[1].toLowerCase().trim();
      }
    }

    if (!failedRecipient) {
      this.logger.debug(
        `Could not extract recipient from bounce. Subject: "${subject}"`,
      );
      return null;
    }

    // --- Step 4: Extract the error/diagnostic message ---
    let errorMessage =
      'Correo rebotado — dirección no válida o buzón inexistente';

    // Priority 1: Diagnostic-Code from DSN part (most descriptive)
    // Format: "Diagnostic-Code: smtp; 550-5.1.1 The email account that..."
    // Can be multiline with continuation lines starting with whitespace
    const diagMatch = fullText.match(
      /Diagnostic-Code:\s*smtp;\s*([\s\S]*?)(?:\n[A-Z]|\n\n|$)/i,
    );
    if (diagMatch) {
      errorMessage = diagMatch[1]
        .replace(/\r?\n\s+/g, ' ') // Join continuation lines
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
    }
    // Priority 2: "said: 550..." from text/plain body
    else {
      const saidMatch = textBody.match(
        /said:\s*([\s\S]*?)(?:\(in reply to|\n\n)/i,
      );
      if (saidMatch) {
        errorMessage = saidMatch[1]
          .replace(/\r?\n\s+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 500);
      }
    }

    return { failedRecipient, errorMessage };
  }

  /**
   * Updates the most recent matching email_log entry from 'sent' to 'bounced'.
   * Only updates if there's a matching recipient with status 'sent' in the last 7 days.
   */
  private async updateEmailLog(
    recipient: string,
    errorMessage: string,
  ): Promise<boolean> {
    const client = this.supabaseService.getClient();

    // Find the most recent 'sent' email for this recipient in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: logs, error: findError } = await client
      .from('email_logs')
      .select('id')
      .eq('recipient', recipient)
      .eq('status', 'sent')
      .gte('sent_at', sevenDaysAgo.toISOString())
      .order('sent_at', { ascending: false })
      .limit(1);

    if (findError) {
      this.logger.error(
        `Error finding email log for ${recipient}:`,
        findError.message,
      );
      return false;
    }

    if (!logs || logs.length === 0) {
      this.logger.debug(
        `No matching 'sent' email log found for bounced recipient: ${recipient}`,
      );
      return false;
    }

    const logId = logs[0].id;

    const { error: updateError } = await client
      .from('email_logs')
      .update({
        status: 'bounced',
        error_message: `[BOUNCE] ${errorMessage}`,
      })
      .eq('id', logId);

    if (updateError) {
      this.logger.error(
        `Error updating email log ${logId} to bounced:`,
        updateError.message,
      );
      return false;
    }

    this.logger.log(`Email log ${logId} updated to 'bounced' for ${recipient}`);
    return true;
  }
}

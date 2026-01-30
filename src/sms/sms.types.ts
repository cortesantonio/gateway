export interface SendSmsJobData {
    number: string;
    message: string;
}

export const SMS_QUEUE_NAME = 'sms-queue';
export const SEND_SMS_JOB_NAME = 'send-sms';

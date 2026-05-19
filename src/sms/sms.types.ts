export interface SendSmsJobData {
  number: string;
  message: string;
}

export const SMS_QUEUE_NAME = 'sms-queue';
export const SEND_SMS_JOB_NAME = 'send-sms';
export const CHECK_SMS_ANSWERS_JOB_NAME = 'check-sms-answers';

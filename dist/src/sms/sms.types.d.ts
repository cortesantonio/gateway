export interface SendSmsJobData {
    number: string;
    message: string;
}
export declare const SMS_QUEUE_NAME = "sms-queue";
export declare const SEND_SMS_JOB_NAME = "send-sms";
export declare const CHECK_SMS_ANSWERS_JOB_NAME = "check-sms-answers";

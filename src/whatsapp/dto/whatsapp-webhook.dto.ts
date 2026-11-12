export class WhatsAppWebhookPayloadDto {
  event: string;
  message_id?: string;
  request_id?: string | null;
  status?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  our_number?: string;
  from?: string;
  type?: string;
  text?: string;
  audio_url?: string;
  transcript?: string | null;
  transcript_status?: 'ok' | 'failed';
  timestamp: string;
}

export type WhatsAppStatusWebhookDto = WhatsAppWebhookPayloadDto & {
  event: 'message.status';
  request_id: string;
  message_id: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
};

export type WhatsAppReceivedWebhookDto = WhatsAppWebhookPayloadDto & {
  event: 'message.received';
  message_id: string;
  our_number: string;
  from: string;
  type: string;
};

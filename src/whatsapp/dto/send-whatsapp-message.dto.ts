export class SendWhatsAppMessageDto {
  notificationId?: number;
  groupId?: string;
  to?: string; // formato solo dígitos, código de país (ej: 56912345678). Opcional si viene notificationId.
  text?: string; // Opcional si viene notificationId (usa texto recordatorio por defecto).
  type?: 'text' | 'image' | 'audio' | 'document';
  media_url?: string;
  filename?: string;
  request_id?: string;
}

export class SendAppointmentsWhatsAppDto {
  notificationIds: number[];
  messages?: Record<string, string>;
}

export class UpdateWhatsAppQuotaDto {
  daily_limit: number;
}

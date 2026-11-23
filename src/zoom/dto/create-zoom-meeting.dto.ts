export class CreateZoomMeetingDto {
  topic!: string;
  agenda?: string;
  startTime!: string; // ISO 8601 string
  durationMinutes?: number;
  cloudRecording?: boolean;
  solicitudId?: string;
}

export interface ZoomMeetingResponse {
  id: string;
  topic: string;
  joinUrl: string;
  startUrl: string;
  password?: string;
  startTime: string;
  duration: number;
}

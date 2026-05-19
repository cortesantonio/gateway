export class SendMassMailDto {
  recipients: {
    email: string;
    vars?: Record<string, string>;
  }[];
  subject: string;
  body: string;
  groupId?: string;
}

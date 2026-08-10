export type TaskType = 'SEND_SMS' | 'CHECK_SMS_ANSWERS';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DeviceStatus = 'online' | 'offline' | 'busy' | 'quota_exceeded';

export class RegisterDeviceDto {
  device_serial: string;
  model_name?: string;
  group_id?: string;
}

export class CreateTaskDto {
  type: TaskType;
  device_serial?: string;
  group_id?: string;
  payload: {
    number?: string;
    message?: string;
    [key: string]: any;
  };
}

export class UpdateTaskStatusDto {
  status: TaskStatus;
  result?: any;
  logs?: string;
  error_message?: string;
  device_serial?: string;
}

export class VerifyLinkDeviceDto {
  /** El serial censurado tal como se muestra en la web (ej: "A65JUT4C2300••••") */
  masked_serial: string;
  /** Los 4 últimos dígitos que el operador ve en la consola del agente local */
  verification_code: string;
  /** ID del grupo/establecimiento al que se quiere vincular */
  group_id: string;
}

export class UpdateQuotaDto {
  monthly_limit: number;
}

export interface DeviceRecord {
  id: string;
  device_serial: string; // Completo si es admin o si is_linked=true
  masked_serial: string; // Siempre censurado (ej: "A65JUT4C2300••••")
  is_linked: boolean; // true = ya vinculado al grupo solicitante
  model_name: string;
  group_id?: string;
  group_name?: string;
  status: DeviceStatus;
  monthly_limit: number;
  current_month_usage: number;
  last_reset_month: string;
  last_seen_at: string;
  created_at: string;
  task_stats?: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  };
  celular_info?: {
    marca?: string;
    modelo?: string;
    numero?: string;
    nombre_completo?: string;
    id_establecimiento?: number;
    estado?: string;
  };
}

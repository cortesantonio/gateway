import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { SupabaseService } from '../auth/supabase.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async sendSms(number: string, message: string): Promise<void> {
    try {
      // Escapar comillas simples para el shell de Android: ' -> '\''
      const safeMessage = message.replace(/'/g, "'\\''");
      const quotedMessage = `'${safeMessage}'`;

      // 1. Abrir app de SMS
      // Usamos execFile para pasar argumentos como array y evitar problemas de parsing del shell local (Windows/Linux)
      await this.executeCommand('adb', [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.SENDTO',
        '-d',
        `sms:${number}`,
        '--es',
        'sms_body',
        quotedMessage,
      ]);
      await this.sleep(1000); // Esperar que abra la app

      // 2. Primera pulsación (Enviar)
      await this.executeCommand('adb', [
        'shell',
        'input',
        'tap',
        '980',
        '2100',
      ]);
      await this.sleep(5000); // Pequeña pausa

      this.logger.log(`Proceso de envío de sms finalizado para ${number}`);
    } catch (error) {
      this.logger.error(
        `Error en el proceso de envío de sms: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async CheckAnswer() {
    try {
      // 1. Extraer los sms de la bandeja de entrada
      const result = await this.executeCommand('adb', [
        'shell',
        'content',
        'query',
        '--uri',
        'content://sms/inbox',
        '--projection',
        '_id,address,date,body,type',
      ]);

      return result;
    } catch (error) {
      this.logger.error(
        `Error en la verificación de respuesta: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async processSmsAnswers() {
    try {
      // 0. Verificar si hay dispositivo conectado
      const isConnected = await this.isDeviceConnected();
      if (!isConnected) {
        this.logger.debug('No Android device connected. Skipping SMS check.');
        return;
      }

      const rawOutput = await this.CheckAnswer();
      const messages = this.parseSmsOutput(rawOutput);

      for (const msg of messages) {
        if (!msg.id || msg.type !== 1) continue; // Solo entrantes y con ID

        // 1. Verificar si ya fue procesado
        const { data: alreadyProcessed } = await this.supabaseService
          .getAdminClient()
          .from('sms_procesados')
          .select('id')
          .eq('sms_id', msg.id)
          .single();

        if (alreadyProcessed) continue;

        // 2. Analizar respuesta (1 o 2)
        const body = msg.body?.trim();
        let newStatus: string | null = null;
        if (body === '1') newStatus = 'confirmado';
        else if (body === '2') newStatus = 'rechazado';

        if (newStatus && msg.address) {
          this.logger.log(
            `Procesando respuesta SMS: ${msg.id} de ${msg.address} con cuerpo: ${body}`,
          );

          // 3. Buscar la cita más reciente pendiente para este teléfono
          // Quitamos el prefijo +56 si existe para buscar más flexiblemente
          const cleanAddress = msg.address.replace(/^\+56/, '');

          const { data: appointment, error: searchError } =
            await this.supabaseService
              .getAdminClient()
              .from('notificacion_cita')
              .select('id')
              .or(
                `telefono_paciente.ilike.%${cleanAddress}%,telefono_paciente.ilike.%${msg.address}%`,
              )
              .eq('estado_confirmacion', 'pendiente')
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

          if (appointment) {
            // 4. Actualizar estado de la cita
            const { error: updateError } = await this.supabaseService
              .getAdminClient()
              .from('notificacion_cita')
              .update({
                estado_confirmacion: newStatus,
                fecha_confirmacion: msg.date
                  ? new Date(msg.date).toISOString()
                  : new Date().toISOString(),
              })
              .eq('id', appointment.id);

            if (updateError) {
              this.logger.error(
                `Error actualizando cita ${appointment.id}: ${updateError.message}`,
              );
            } else {
              this.logger.log(
                `Cita ${appointment.id} actualizada a ${newStatus} por SMS ${msg.id}`,
              );
            }
          } else {
            this.logger.warn(
              `No se encontró cita pendiente para el número ${msg.address}`,
            );
          }
        }

        // 5. Marcar SMS como procesado (incluso si no hubo match, para no re-evaluar)
        await this.supabaseService
          .getAdminClient()
          .from('sms_procesados')
          .insert({ sms_id: msg.id, address: msg.address, body: msg.body });
      }
    } catch (error) {
      this.logger.error(
        `Error en processSmsAnswers: ${error.message}`,
        error.stack,
      );
    }
  }

  public parseSmsOutput(output: string) {
    if (!output) return [];
    return output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('Row:'))
      .filter((a) => !a.includes('Movistar'))
      .map((line) => {
        line = line.replace(/\n/g, ' ');
        const idMatch = line.match(/_id=(\d+)/);
        const rowMatch = line.match(/Row:\s*(\d+)/);
        const addressMatch = line.match(/address=([^,]+)/);
        const bodyMatch = line.match(/body=([^,]+(?:,[^t]+)?)/);
        const typeMatch = line.match(/type=(\d+)/);
        const dateMatch = line.match(/date=(\d+)/);

        return {
          id: idMatch ? Number(idMatch[1]) : null,
          row: rowMatch ? Number(rowMatch[1]) : null,
          address: addressMatch ? addressMatch[1].trim() : null,
          body: bodyMatch ? bodyMatch[1].trim() : null,
          type: typeMatch ? Number(typeMatch[1]) : null,
          date: dateMatch ? Number(dateMatch[1]) : null,
        };
      });
  }

  private async isDeviceConnected(): Promise<boolean> {
    try {
      const output = await this.executeCommand('adb', ['devices']);
      // Output format:
      // List of devices attached
      // <serial>    device
      // <serial>    offline

      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim() === 'List of devices attached') continue;
        if (line.includes('\tdevice')) return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Error checking device connection: ${error.message}`);
      return false;
    }
  }

  private executeCommand(file: string, args: string[]): Promise<string> {
    const fullCommand = `${file} ${args.join(' ')}`;
    return new Promise((resolve, reject) => {
      execFile(file, args, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error comando '${fullCommand}': ${error.message}`);
          reject(error);
        } else {
          if (stderr) {
            this.logger.warn(`Stderr '${fullCommand}': ${stderr}`);
          }
          resolve(stdout);
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

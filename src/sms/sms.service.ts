import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);

    async sendSms(number: string, message: string): Promise<void> {
        try {
            this.logger.log(`Iniciando proceso de envío de SMS a ${number}...`);

            // Escapar comillas simples para el shell de Android: ' -> '\''
            const safeMessage = message.replace(/'/g, "'\\''");
            const quotedMessage = `'${safeMessage}'`;

            // 1. Abrir app de SMS
            // Usamos execFile para pasar argumentos como array y evitar problemas de parsing del shell local (Windows/Linux)
            await this.executeCommand('adb', [
                'shell', 'am', 'start',
                '-a', 'android.intent.action.SENDTO',
                '-d', `sms:${number}`,
                '--es', 'sms_body', quotedMessage
            ]);
            await this.sleep(1000); // Esperar que abra la app

            // 2. Primera pulsación (Enviar)
            await this.executeCommand('adb', ['shell', 'input', 'tap', '980', '2100']);
            await this.sleep(5000); // Pequeña pausa

            this.logger.log(`Proceso de envío finalizado para ${number}`);
        } catch (error) {
            this.logger.error(`Error en el proceso de envío SMS: ${error.message}`, error.stack);
            throw error;
        }
    }

    private executeCommand(file: string, args: string[]): Promise<string> {
        const fullCommand = `${file} ${args.join(' ')}`;
        this.logger.debug(`Ejecutando: ${fullCommand}`);

        return new Promise((resolve, reject) => {
            execFile(file, args, (error, stdout, stderr) => {
                if (error) {
                    this.logger.error(`Error comando '${fullCommand}': ${error.message}`);
                    reject(error);
                } else {
                    if (stderr) {
                        this.logger.warn(`Stderr '${fullCommand}': ${stderr}`);
                    }
                    if (stdout) {
                        this.logger.verbose(`Stdout '${fullCommand}': ${stdout.trim()}`);
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

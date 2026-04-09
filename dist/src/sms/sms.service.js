"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SmsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const supabase_service_1 = require("../auth/supabase.service");
let SmsService = SmsService_1 = class SmsService {
    supabaseService;
    logger = new common_1.Logger(SmsService_1.name);
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async sendSms(number, message) {
        try {
            const safeMessage = message.replace(/'/g, "'\\''");
            const quotedMessage = `'${safeMessage}'`;
            await this.executeCommand('adb', [
                'shell', 'am', 'start',
                '-a', 'android.intent.action.SENDTO',
                '-d', `sms:${number}`,
                '--es', 'sms_body', quotedMessage
            ]);
            await this.sleep(1000);
            await this.executeCommand('adb', ['shell', 'input', 'tap', '980', '2100']);
            await this.sleep(5000);
            this.logger.log(`Proceso de envío de sms finalizado para ${number}`);
        }
        catch (error) {
            this.logger.error(`Error en el proceso de envío de sms: ${error.message}`, error.stack);
            throw error;
        }
    }
    async CheckAnswer() {
        try {
            const result = await this.executeCommand('adb', [
                'shell', 'content', 'query',
                '--uri', 'content://sms/inbox',
                '--projection', '_id,address,date,body,type',
            ]);
            return result;
        }
        catch (error) {
            this.logger.error(`Error en la verificación de respuesta: ${error.message}`, error.stack);
            throw error;
        }
    }
    async processSmsAnswers() {
        try {
            const isConnected = await this.isDeviceConnected();
            if (!isConnected) {
                this.logger.debug('No Android device connected. Skipping SMS check.');
                return;
            }
            const rawOutput = await this.CheckAnswer();
            const messages = this.parseSmsOutput(rawOutput);
            for (const msg of messages) {
                if (!msg.id || msg.type !== 1)
                    continue;
                const { data: alreadyProcessed } = await this.supabaseService.getAdminClient()
                    .from('sms_procesados')
                    .select('id')
                    .eq('sms_id', msg.id)
                    .single();
                if (alreadyProcessed)
                    continue;
                const body = msg.body?.trim();
                let newStatus = null;
                if (body === '1')
                    newStatus = 'confirmado';
                else if (body === '2')
                    newStatus = 'rechazado';
                if (newStatus && msg.address) {
                    this.logger.log(`Procesando respuesta SMS: ${msg.id} de ${msg.address} con cuerpo: ${body}`);
                    const cleanAddress = msg.address.replace(/^\+56/, '');
                    const { data: appointment, error: searchError } = await this.supabaseService.getAdminClient()
                        .from('notificacion_cita')
                        .select('id')
                        .or(`telefono_paciente.ilike.%${cleanAddress}%,telefono_paciente.ilike.%${msg.address}%`)
                        .eq('estado_confirmacion', 'pendiente')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();
                    if (appointment) {
                        const { error: updateError } = await this.supabaseService.getAdminClient()
                            .from('notificacion_cita')
                            .update({
                            estado_confirmacion: newStatus,
                            fecha_confirmacion: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString()
                        })
                            .eq('id', appointment.id);
                        if (updateError) {
                            this.logger.error(`Error actualizando cita ${appointment.id}: ${updateError.message}`);
                        }
                        else {
                            this.logger.log(`Cita ${appointment.id} actualizada a ${newStatus} por SMS ${msg.id}`);
                        }
                    }
                    else {
                        this.logger.warn(`No se encontró cita pendiente para el número ${msg.address}`);
                    }
                }
                await this.supabaseService.getAdminClient()
                    .from('sms_procesados')
                    .insert({ sms_id: msg.id, address: msg.address, body: msg.body });
            }
        }
        catch (error) {
            this.logger.error(`Error en processSmsAnswers: ${error.message}`, error.stack);
        }
    }
    parseSmsOutput(output) {
        if (!output)
            return [];
        return output
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('Row:'))
            .filter(a => !a.includes('Movistar'))
            .map(line => {
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
                date: dateMatch ? Number(dateMatch[1]) : null
            };
        });
    }
    async isDeviceConnected() {
        try {
            const output = await this.executeCommand('adb', ['devices']);
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.trim() === 'List of devices attached')
                    continue;
                if (line.includes('\tdevice'))
                    return true;
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Error checking device connection: ${error.message}`);
            return false;
        }
    }
    executeCommand(file, args) {
        const fullCommand = `${file} ${args.join(' ')}`;
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)(file, args, (error, stdout, stderr) => {
                if (error) {
                    this.logger.error(`Error comando '${fullCommand}': ${error.message}`);
                    reject(error);
                }
                else {
                    if (stderr) {
                        this.logger.warn(`Stderr '${fullCommand}': ${stderr}`);
                    }
                    resolve(stdout);
                }
            });
        });
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};
exports.SmsService = SmsService;
exports.SmsService = SmsService = SmsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], SmsService);
//# sourceMappingURL=sms.service.js.map
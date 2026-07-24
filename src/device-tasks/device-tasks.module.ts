import { Module } from '@nestjs/common';
import { DeviceTasksController } from './device-tasks.controller';
import { DeviceTasksService } from './device-tasks.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DeviceTasksController],
  providers: [DeviceTasksService],
  exports: [DeviceTasksService],
})
export class DeviceTasksModule {}

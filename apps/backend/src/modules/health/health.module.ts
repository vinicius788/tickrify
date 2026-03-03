import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OpsTokenGuard } from './ops-token.guard';

@Module({
  controllers: [HealthController],
  providers: [OpsTokenGuard],
})
export class HealthModule {}

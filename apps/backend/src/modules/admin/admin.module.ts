import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { ReportsModule } from '../reports/reports.module';
import { PaymentsModule } from '../payments/payments.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [ReportsModule, PaymentsModule, AiModule],
  controllers: [AdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class AdminModule {}

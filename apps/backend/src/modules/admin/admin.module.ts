import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { ReportsModule } from '../reports/reports.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [ReportsModule, PaymentsModule],
  controllers: [AdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [AdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class AdminModule {}

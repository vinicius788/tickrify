import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AffiliatesService } from './affiliates.service';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesAdminController } from './affiliates-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AffiliatesController, AffiliatesAdminController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}

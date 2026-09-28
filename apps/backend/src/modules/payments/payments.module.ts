import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';

@Module({
  imports: [DatabaseModule, AuthModule, AffiliatesModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class PaymentsModule {}

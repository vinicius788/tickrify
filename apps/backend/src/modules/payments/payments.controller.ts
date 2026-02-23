import { Controller, Post, Body, UseGuards, Req, Headers, RawBodyRequest } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../database/prisma.service';
import { CreateLegacyCheckoutDto } from './dto/create-legacy-checkout.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private prisma: PrismaService,
  ) {}

  @Post('create-checkout')
  @UseGuards(AuthGuard)
  async createCheckout(
    @CurrentUser() user: { clerkUserId: string },
    @Body() body: CreateLegacyCheckoutDto,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { clerkUserId: user.clerkUserId },
    });

    return this.paymentsService.createCheckoutSession(
      dbUser!.id,
      body.priceId,
      body.mode as 'payment' | 'subscription',
    );
  }

  @Post('webhooks/stripe')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.paymentsService.handleWebhook(signature, req.rawBody!);
  }
}

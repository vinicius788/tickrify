import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
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

    if (!dbUser) {
      throw new NotFoundException('Authenticated user not found');
    }

    return this.paymentsService.createCheckoutSession(
      dbUser.id,
      body.priceId,
      body.mode as 'payment' | 'subscription',
    );
  }

  @Post('webhooks/stripe')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    return this.paymentsService.handleWebhook(signature, req.rawBody);
  }
}

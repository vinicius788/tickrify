import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TicksService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<number> {
    const record = await this.prisma.userTicks.findUnique({
      where: { userId },
      select: { balance: true },
    });

    return record?.balance ?? 0;
  }

  async addTicks(
    userId: string,
    amount: number,
    description: string,
    stripePaymentIntentId?: string,
  ): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be greater than zero');
    }

    if (stripePaymentIntentId) {
      const existing = await this.prisma.tickTransaction.findUnique({
        where: { stripePaymentIntentId },
        select: { id: true },
      });

      if (existing) {
        return;
      }
    }

    try {
      await this.prisma.$transaction([
        this.prisma.userTicks.upsert({
          where: { userId },
          create: { userId, balance: amount },
          update: { balance: { increment: amount } },
        }),
        this.prisma.tickTransaction.create({
          data: {
            userId,
            amount,
            type: 'PURCHASE',
            description,
            stripePaymentIntentId,
          },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        stripePaymentIntentId
      ) {
        return;
      }

      throw error;
    }
  }

  async debitTicks(
    userId: string,
    amount: number,
    description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be greater than zero');
    }

    const record = await this.prisma.userTicks.findUnique({
      where: { userId },
      select: { balance: true },
    });

    const balance = record?.balance ?? 0;

    if (!record || balance < amount) {
      throw new BadRequestException(
        JSON.stringify({
          code: 'INSUFFICIENT_TICKS',
          message: `Ticks insuficientes. Necessário: ${amount}, disponível: ${balance}.`,
          required: amount,
          balance,
        }),
      );
    }

    await this.prisma.$transaction([
      this.prisma.userTicks.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.tickTransaction.create({
        data: {
          userId,
          amount: -amount,
          type: 'USAGE',
          description,
          metadata: (metadata ?? {}) as Prisma.InputJsonValue,
        },
      }),
    ]);
  }

  async getHistory(userId: string) {
    return this.prisma.tickTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

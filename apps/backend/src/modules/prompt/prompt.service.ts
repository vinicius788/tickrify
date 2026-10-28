import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PromptService {
  constructor(private prisma: PrismaService) {}

  async getLatestPrompt() {
    const prompt = await this.prisma.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    if (!prompt) {
      throw new NotFoundException('No active prompt found');
    }

    return prompt;
  }

  async getPromptByVersion(version: number) {
    const prompt = await this.prisma.promptConfig.findUnique({
      where: { version },
    });

    if (!prompt) {
      throw new NotFoundException(`Prompt version ${version} not found`);
    }

    return prompt;
  }

  async listPrompts() {
    return this.prisma.promptConfig.findMany({
      orderBy: { version: 'desc' },
    });
  }
}

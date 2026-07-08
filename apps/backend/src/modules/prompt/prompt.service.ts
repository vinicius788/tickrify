import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface PromptActor {
  id: string;
  clerkUserId: string;
}

@Injectable()
export class PromptService {
  constructor(private prisma: PrismaService) {}

  async createPromptConfig(prompt: string, setActive = true, actor: PromptActor) {
    // Buscar última versão
    const lastVersion = await this.prisma.promptConfig.findFirst({
      orderBy: { version: 'desc' },
    });

    const newVersion = (lastVersion?.version || 0) + 1;

    // Se setActive = true, desativar todos os outros prompts
    if (setActive) {
      await this.prisma.promptConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }

    const createdPrompt = await this.prisma.promptConfig.create({
      data: {
        version: newVersion,
        prompt,
        isActive: setActive,
      },
    });

    await this.prisma.promptAudit.create({
      data: {
        promptConfigId: createdPrompt.id,
        action: 'create_prompt_config',
        actorUserId: actor.id,
        actorClerkUserId: actor.clerkUserId,
        payload: {
          version: createdPrompt.version,
          isActive: createdPrompt.isActive,
          promptLength: prompt.length,
        },
      },
    });

    return createdPrompt;
  }

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

  async activatePrompt(version: number, actor: PromptActor) {
    // Desativar todos
    await this.prisma.promptConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // Ativar o específico
    const activatedPrompt = await this.prisma.promptConfig.update({
      where: { version },
      data: { isActive: true },
    });

    await this.prisma.promptAudit.create({
      data: {
        promptConfigId: activatedPrompt.id,
        action: 'activate_prompt_version',
        actorUserId: actor.id,
        actorClerkUserId: actor.clerkUserId,
        payload: {
          version: activatedPrompt.version,
        },
      },
    });

    return activatedPrompt;
  }
}

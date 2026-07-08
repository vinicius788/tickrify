import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';

/**
 * Sincroniza o prompt do CÓDIGO (TRADING_SYSTEM_PROMPT) para o banco
 * (PromptConfig) automaticamente no boot do backend.
 *
 * Por quê: o motor envia para a IA o prompt ATIVO no banco, não o arquivo de
 * código (o código é só fallback quando não há config ativa). Antes, atualizar
 * o prompt em produção exigia rodar o seed/sync na mão — e era fácil esquecer,
 * deixando a IA com um prompt antigo. Agora, todo deploy (que reinicia o app)
 * garante que o prompt do código está ativo no banco.
 *
 * Garantias:
 * - Idempotente: só grava quando o prompt ativo difere do código. Reinícios sem
 *   mudança de prompt não geram versão nova nem escrita.
 * - Não-destrutivo: cria uma versão nova (histórico preservado) e desativa as
 *   demais — mesma mecânica do painel admin.
 * - Best-effort: qualquer falha é logada e o app sobe normalmente.
 * - Kill-switch: PROMPT_AUTO_SYNC=false desliga o comportamento.
 */
@Injectable()
export class PromptSyncService implements OnModuleInit {
  private readonly logger = new Logger(PromptSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.PROMPT_AUTO_SYNC === 'false') {
      this.logger.log('Auto-sync de prompt desligado (PROMPT_AUTO_SYNC=false).');
      return;
    }

    try {
      const codePrompt = TRADING_SYSTEM_PROMPT.trim();

      const active = await this.prisma.promptConfig.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
      });

      if (active && active.prompt.trim() === codePrompt) {
        this.logger.log(`Prompt em dia (v${active.version}) — nada a sincronizar.`);
        return;
      }

      const last = await this.prisma.promptConfig.findFirst({
        orderBy: { version: 'desc' },
      });
      const newVersion = (last?.version ?? 0) + 1;

      await this.prisma.promptConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      const created = await this.prisma.promptConfig.create({
        data: { version: newVersion, prompt: codePrompt, isActive: true },
      });

      this.logger.warn(
        `Prompt do código sincronizado para o banco: v${created.version} ativada (${codePrompt.length} chars).`,
      );
    } catch (err) {
      // Best-effort: uma falha aqui NUNCA pode derrubar o backend.
      this.logger.error(
        `Falha ao auto-sincronizar o prompt (app segue normal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

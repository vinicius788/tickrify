import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import { AnalysisType } from '../ticks/tick-packages';

const DETERMINISTIC_CONSISTENCY_INSTRUCTION = `
# CONSISTÊNCIA OBRIGATÓRIA
Seja determinístico. Para o mesmo gráfico, sempre gere a mesma análise.
Não varie sua recomendação entre chamadas para a mesma imagem.
Se a estrutura indica COMPRA, indique COMPRA. Não mude para AGUARDAR sem razão técnica clara.
`.trim();

const PARTS_SEPARATOR = '\n\n---\n\n';

@Injectable()
export class PromptBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the final prompt following the hierarchy:
   * 1. promptOverride (if provided) → used directly
   * 2. Active PromptConfig for the analysisType → used as base
   * 3. TRADING_SYSTEM_PROMPT default → fallback
   *
   * DETERMINISTIC_CONSISTENCY_INSTRUCTION is always appended at the end.
   */
  async buildPrompt(analysisType: AnalysisType, override?: string): Promise<string> {
    if (override) {
      return this.appendConsistencyInstruction(override);
    }

    const activeConfig = await this.prisma.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    const base = activeConfig?.prompt || TRADING_SYSTEM_PROMPT;
    return this.appendConsistencyInstruction(base);
  }

  /**
   * Resolves the prompt using a specific version number (used by the worker/queue path).
   * Falls back to buildPrompt if the version isn't found.
   */
  async buildPromptByVersion(
    analysisType: AnalysisType,
    promptVersion?: number,
    override?: string,
  ): Promise<string> {
    if (override) {
      return this.appendConsistencyInstruction(override);
    }

    if (promptVersion) {
      const config = await this.prisma.promptConfig.findUnique({
        where: { version: promptVersion },
      });
      if (config?.prompt) {
        return this.appendConsistencyInstruction(config.prompt);
      }
    }

    return this.buildPrompt(analysisType);
  }

  /**
   * Concatenates prompt parts with a visual separator.
   */
  composePromptParts(parts: string[]): string {
    return parts
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .join(PARTS_SEPARATOR);
  }

  private appendConsistencyInstruction(prompt: string): string {
    const normalized = String(prompt || '').trim();
    if (!normalized) {
      return DETERMINISTIC_CONSISTENCY_INSTRUCTION;
    }

    if (normalized.includes('Seja determinístico. Para o mesmo gráfico')) {
      return normalized;
    }

    return `${normalized}\n\n${DETERMINISTIC_CONSISTENCY_INSTRUCTION}`;
  }
}

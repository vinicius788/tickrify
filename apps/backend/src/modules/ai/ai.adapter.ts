import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AIAnalysisResponse } from '../../common/interfaces/ai-response.interface';
import {
  normalizeBias,
  normalizeConfidence,
  normalizeReasoning,
  normalizeRecommendation,
  parseJsonFromContent,
} from '../../common/utils/analysis-normalizer';
import { normalizeDrawingPlan } from '../../common/utils/drawing-plan';

const ENFORCED_OUTPUT_BLOCK = `
OUTPUT RULES (MANDATORY):
- Return ONLY valid JSON.
- recommendation must be exactly "BUY", "SELL", or "WAIT" (never HOLD).
- bias is mandatory and must be exactly "bullish", "bearish", or "neutral".
- recommendation/bias mapping is mandatory:
  BUY -> bullish
  SELL -> bearish
  WAIT -> neutral
- reasoning must reference at least 2 drawing element IDs when drawing_plan exists.
- Include drawing_plan with normalized coordinates (0 to 1):
{
  "drawing_plan": {
    "elements": [
      {
        "id": "support_1",
        "type": "line|rectangle|arrow|label",
        "x1": 0.0,
        "y1": 0.0,
        "x2": 0.0,
        "y2": 0.0,
        "x": 0.0,
        "y": 0.0,
        "width": 0.0,
        "height": 0.0,
        "label": "optional text",
        "color": "#22c55e",
        "strokeWidth": 2
      }
    ]
  }
}
`;

@Injectable()
export class AIAdapter {
  private readonly openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || 'OPENAI_API_KEY_PLACEHOLDER';

    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        '⚠️ OPENAI_API_KEY not configured. Using a dummy key. AI analysis will not work in production.',
      );
    }

    this.openai = new OpenAI({
      apiKey,
    });
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<AIAnalysisResponse> {
    try {
      const initial = await this.requestAnalysis(imageUrl, this.buildPrompt(prompt));
      let parsed = this.parseAIResponse(initial.content, initial.rawResponse);

      if (!parsed.drawingPlan || parsed.drawingPlan.elements.length === 0) {
        const retryPrompt = `${this.buildPrompt(
          prompt,
        )}\n\nRETRY: previous response missed drawing_plan. Return complete JSON now.`;
        const retry = await this.requestAnalysis(imageUrl, retryPrompt);
        const retryParsed = this.parseAIResponse(retry.content, retry.rawResponse);
        if (retryParsed.drawingPlan && retryParsed.drawingPlan.elements.length > 0) {
          parsed = retryParsed;
        } else {
          parsed.drawingFailed = true;
        }
      }

      return parsed;
    } catch (error) {
      console.error('AI Analysis Error:', error);
      throw new Error('Failed to analyze image with AI');
    }
  }

  private buildPrompt(prompt: string): string {
    return `${prompt}\n\n${ENFORCED_OUTPUT_BLOCK}`.trim();
  }

  private async requestAnalysis(
    imageUrl: string,
    prompt: string,
  ): Promise<{ content: string; rawResponse: any }> {
    const response = await this.openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an elite technical analyst. You must inspect the chart image and output strict JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 2500,
      temperature: 0.2,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      rawResponse: response,
    };
  }

  private parseAIResponse(content: string, rawResponse: any): AIAnalysisResponse {
    const parsedJson = parseJsonFromContent(content);

    if (parsedJson) {
      const recommendation = normalizeRecommendation(
        parsedJson.recommendation || parsedJson.recomendacao,
      );
      const bias = normalizeBias(
        parsedJson.bias || parsedJson.analysis?.marketStructure?.bias,
        recommendation,
      );
      const confidence = normalizeConfidence(
        parsedJson.confidence ?? parsedJson.confianca,
        50,
      );
      const reasoning = normalizeReasoning(
        parsedJson.reasoning || parsedJson.justificativa || parsedJson.analysis?.technicalAnalysis,
        content,
      );
      const drawingPlan = normalizeDrawingPlan(
        parsedJson.drawing_plan || parsedJson.drawingPlan,
      );

      return {
        recommendation,
        bias,
        confidence,
        reasoning,
        analysis: parsedJson.analysis,
        drawingPlan,
        rawResponse: parsedJson,
      };
    }

    const recommendation = normalizeRecommendation(content);
    const bias = normalizeBias(content, recommendation);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    const confidence = normalizeConfidence(
      confidenceMatch ? Number(confidenceMatch[1]) : 50,
      50,
    );

    return {
      recommendation,
      bias,
      confidence,
      reasoning: normalizeReasoning(content),
      drawingPlan: null,
      drawingFailed: true,
      rawResponse,
    };
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DemoService } from './demo.service';
import { DemoAnalyzeDto, DemoStatusDto } from './dto/demo-analyze.dto';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';

/**
 * Endpoints PÚBLICOS da demo anônima. Sem AuthGuard de propósito:
 * o visitante ainda não tem conta. Toda a proteção anti-abuso fica em camadas:
 * 1. Turnstile (anti-bot) — verificado no servidor (DemoService).
 * 2. Rate limit por IP (tentativas): 3/h via Throttler (tracker = IP p/ anônimos).
 * 3. Cota persistente de 1 análise concluída por fingerprint (Supabase).
 * 4. Teto persistente por IP em 24h (custo máximo de API por IP).
 */
@Public()
@Controller('demo')
export class DemoController {
  constructor(private demoService: DemoService) {}

  /** Mesma identidade do rate limit, resolvida pelo trust proxy do Express. */
  private resolveIp(req: Request): string {
    return String(req.ip || req.socket?.remoteAddress || 'unknown');
  }

  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 },
    }),
  )
  // Teto de TENTATIVAS por hora por IP (falhas também contam — spec 6.1).
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  async analyze(
    @Req() req: Request,
    @UploadedFile() file: UploadedFileType,
    @Body() body: DemoAnalyzeDto,
  ) {
    return this.demoService.analyze({
      file,
      base64Image: body.base64Image,
      fingerprint: body.fingerprint,
      turnstileToken: body.turnstileToken,
      ip: this.resolveIp(req),
      userLanguage: body.userLanguage,
    });
  }

  /**
   * Estado da cota deste device — permite à UI abrir já no estado "bloqueado"
   * (CTA de cadastro) sem gastar uma tentativa. Devolve `used` e, por 24h, a
   * leitura ja sanitizada que este mesmo device recebeu.
   */
  @Get('status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async status(@Query() query: DemoStatusDto) {
    // `result`: a leitura das ultimas 24h deste device, para a tela mostrar o
    // que a pessoa ja recebeu em vez de so "voce ja usou".
    return this.demoService.getFingerprintStatus(query.fingerprint);
  }
}

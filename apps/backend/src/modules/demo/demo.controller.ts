import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DemoService } from './demo.service';
import { DemoAnalyzeDto, DemoStatusDto, ExampleAnalyzeDto } from './dto/demo-analyze.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';

/**
 * Endpoints da demo. `analyze` e `status` são PÚBLICOS (o visitante ainda não
 * tem conta; @Public() em cada método, não na classe, porque `example` exige
 * login). Proteção anti-abuso da demo pública, em camadas:
 * 1. Turnstile (anti-bot) — verificado no servidor (DemoService).
 * 2. Rate limit por IP (tentativas): 3/h via Throttler (tracker = IP p/ anônimos).
 * 3. Cota persistente de 1 análise concluída por fingerprint (Supabase).
 * 4. Teto persistente por IP em 24h (custo máximo de API por IP).
 */
@Controller('demo')
export class DemoController {
  constructor(private demoService: DemoService) {}

  /** Mesma identidade do rate limit, resolvida pelo trust proxy do Express. */
  private resolveIp(req: Request): string {
    return String(req.ip || req.socket?.remoteAddress || 'unknown');
  }

  @Post('analyze')
  @Public()
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
   * (CTA de cadastro) sem gastar uma tentativa. Não revela nada além de used.
   */
  @Get('status')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async status(@Query() query: DemoStatusDto) {
    const used = await this.demoService.isFingerprintUsed(query.fingerprint);
    return { used };
  }

  /**
   * "Try it with an example chart" do painel: o grafico de exemplo, uma vez
   * por conta, sem gastar a cota gratis. Regras em DemoService.analyzeExampleForUser.
   */
  @Post('example')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async analyzeExample(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: UploadedFileType,
    @Body() body: ExampleAnalyzeDto,
  ) {
    return this.demoService.analyzeExampleForUser({
      userId: user.id,
      file,
      userLanguage: body.userLanguage,
    });
  }
}

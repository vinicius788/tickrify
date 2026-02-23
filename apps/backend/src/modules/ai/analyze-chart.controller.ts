import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../database/prisma.service';
import { AiService } from './ai.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

@Controller()
export class AnalyzeChartController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('analyze-chart')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async analyzeChart(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @UploadedFile() file: UploadedFileType,
    @Body() body: CreateAnalysisDto,
  ) {
    if (!user.id) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    return this.aiService.createAnalysis(user.id, file, body.base64Image, body.promptOverride);
  }

  @Get('analyses/:id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async getAnalysis(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
  ) {
    const dbUserId =
      user.id ||
      (
        await this.prisma.user.findUnique({
          where: { clerkUserId: user.clerkUserId },
          select: { id: true },
        })
      )?.id;

    if (!dbUserId) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    return this.aiService.getAnalysis(id, dbUserId);
  }
}

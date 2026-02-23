import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { AiService } from './ai.service';
import { PrismaService } from '../database/prisma.service';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ListAnalysesQueryDto } from './dto/list-analyses-query.dto';

@Controller('ai')
export class AiController {
  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
  ) {}

  @Post('analyze')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async analyze(
    @CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null },
    @UploadedFile() file: UploadedFileType,
    @Body() body: CreateAnalysisDto,
  ) {
    try {
      console.log('[AiController] analyze endpoint called', { 
        userId: user.id,
        clerkUserId: user.clerkUserId,
        hasFile: !!file,
        hasBase64: !!body.base64Image 
      });

      let dbUserId = user.id;
      if (!dbUserId) {
        const dbUser = await this.prisma.user.findUnique({
          where: { clerkUserId: user.clerkUserId },
        });
        dbUserId = dbUser?.id;
      }

      if (!dbUserId) {
        throw new UnauthorizedException('Authenticated user could not be resolved');
      }

      const result = await this.aiService.createAnalysis(
        dbUserId,
        file,
        body.base64Image,
        body.promptOverride,
      );

      console.log('[AiController] Analysis created successfully:', result.id);
      return result;
    } catch (error) {
      console.error('[AiController] Error in analyze endpoint:', error);
      throw error;
    }
  }

  @Get('analysis/:id')
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

  @Get('analyses')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async listAnalyses(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Query() query: ListAnalysesQueryDto,
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

    return this.aiService.listAnalyses(dbUserId, query.limit ?? 20);
  }
}

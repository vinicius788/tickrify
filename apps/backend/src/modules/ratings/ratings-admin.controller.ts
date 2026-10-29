import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RatingsService } from './ratings.service';
import { PublishRatingDto } from './dto/ratings.dto';

/** Admin das notas. Guardas na CLASSE, igual aos outros controllers de admin. */
@Controller('admin/ratings')
@UseGuards(AuthGuard, AdminGuard)
export class RatingsAdminController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(@Query('includeUsefulness') includeUsefulness?: string) {
    return this.ratings.adminList(includeUsefulness === 'true');
  }

  @Patch(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  publish(@Param('id') id: string, @Body() body: PublishRatingDto) {
    return this.ratings.adminPublish(id, body);
  }
}

import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RatingsService } from './ratings.service';
import { CreateRatingDto, UpdateRatingDto } from './dto/ratings.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/** Estrelas abaixo do resultado e os depoimentos publicados no site. */
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  rate(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateRatingDto) {
    return this.ratings.rate({ id: this.requireId(user), clerkUserId: user.clerkUserId }, body.analysisId, body.rating);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  details(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: UpdateRatingDto) {
    if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new NotFoundException({ code: 'rating_not_found' });
    return this.ratings.addDetails({ id: this.requireId(user), clerkUserId: user.clerkUserId }, id, body);
  }

  /** Publico: so depoimento com licenca do assinante e aprovado pelo admin. */
  @Public()
  @Get('testimonials')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async testimonials() {
    return { items: await this.ratings.testimonials() };
  }

  private requireId(user: AuthenticatedUser): string {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return user.id;
  }
}

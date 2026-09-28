import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AffiliatesService } from './affiliates.service';
import { AdminPayoutActionDto, AdminUpdateAffiliateDto } from './dto/affiliates.dto';

/**
 * Admin dos afiliados. Guardas na CLASSE, igual ao AdminController: metodo
 * novo aqui nao pode depender de alguem lembrar do AdminGuard.
 */
@Controller('admin/affiliates')
@UseGuards(AuthGuard, AdminGuard)
export class AffiliatesAdminController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list() {
    return this.affiliates.adminList();
  }

  @Get('payouts')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listPayouts() {
    return this.affiliates.adminListPayouts();
  }

  @Patch('payouts/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  decidePayout(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: AdminPayoutActionDto,
  ) {
    return this.affiliates.adminDecidePayout(id, body.action, user.id, body.note);
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  detail(@Param('id') id: string) {
    return this.affiliates.adminDetail(id);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() body: AdminUpdateAffiliateDto) {
    return this.affiliates.adminUpdate(id, body, user.id);
  }
}

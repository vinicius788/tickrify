import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AiModule } from './modules/ai/ai.module';
import { PromptModule } from './modules/prompt/prompt.module';
import { HealthModule } from './modules/health/health.module';
import { TicksModule } from './modules/ticks/ticks.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { MarketModule } from './modules/market/market.module';
import { MailModule } from './modules/mail/mail.module';
import { DemoModule } from './modules/demo/demo.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { GlobalAuthGuard } from './common/guards/global-auth.guard';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ 
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 150, // 150 req/min por usuário como safety net global (abuso)
      },
    ]),
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
    DatabaseModule,
    MailModule,
    AuthModule,
    PaymentsModule,
    TicksModule,
    AiModule,
    DemoModule,
    CalendarModule,
    MarketModule,
    PromptModule,
    HealthModule,
  ],
  providers: [
    // ORDEM IMPORTA. O Nest executa os APP_GUARD na ordem em que são
    // registrados: primeiro o rate limit (barato, rejeita abuso antes de tocar
    // o banco), depois a autenticação.
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    // NEGAR POR PADRÃO (12/08/2026). Sem este registro, rota nova sem
    // `@UseGuards(AuthGuard)` nasce PÚBLICA — foi o achado principal da
    // auditoria de acesso. Com ele, a omissão fecha, e abrir uma rota exige
    // marcar `@Public()` explicitamente.
    //
    // ⚠️ NÃO REMOVER sem antes conferir que toda rota tem guard próprio. O teste
    // common/guards/__tests__/route-access.spec.ts falha se alguma rota ficar
    // sem decisão de acesso.
    {
      provide: APP_GUARD,
      useClass: GlobalAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
})
export class AppModule {
  // O prefixo global 'api' é configurado no main.ts e vercel.ts
}

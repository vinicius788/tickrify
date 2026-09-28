import { IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * ⚠️ TODO campo com decorator: o ValidationPipe global roda com `whitelist` e
 * `forbidNonWhitelisted`, e campo sem decorator derruba a requisicao inteira
 * (ver set-strategy.dto.spec.ts). Nenhum valor em dinheiro entra por aqui: o
 * valor da comissao e do saque e sempre calculado no servidor.
 */

/** Codigo como o visitante digita ou chega no link (maiusculas no servico). */
const CODE_INPUT = /^[A-Za-z0-9]{4,20}$/;
/** cuid do Prisma. */
const CUID = /^[a-z0-9]{20,40}$/;

export class TrackAffiliateDto {
  @Matches(CODE_INPUT)
  code!: string;

  @IsIn(['link', 'coupon'])
  kind!: 'link' | 'coupon';

  @IsOptional()
  @IsString()
  @MaxLength(240)
  landingPath?: string;
}

export class ClaimAffiliateDto {
  @Matches(CODE_INPUT)
  code!: string;

  @IsIn(['link', 'coupon'])
  kind!: 'link' | 'coupon';

  @IsOptional()
  @Matches(CUID)
  clickId?: string;
}

/**
 * Pedido de entrada. Tudo obrigatorio: sem canal e audiencia o admin nao tem
 * como decidir. Link so https (vira link clicavel no /admin). O texto livre
 * so aparece para o admin, nunca perto do prompt do motor.
 */
export class JoinAffiliateDto {
  @IsIn(['youtube', 'instagram', 'tiktok', 'x', 'telegram', 'discord', 'website', 'other'])
  platform!: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(300)
  url!: string;

  @IsIn(['under_1k', '1k_10k', '10k_50k', '50k_plus'])
  audience!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(500)
  note!: string;
}

export class RequestPayoutDto {
  /** Para onde mandar o dinheiro (ex.: "PayPal: nome@email.com"). Texto curto. */
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  method!: string;
}

export class AdminUpdateAffiliateDto {
  @IsOptional()
  /** approve = ACTIVE, reject = REJECTED, suspend = SUSPENDED, reactivate = ACTIVE. */
  @IsIn(['ACTIVE', 'REJECTED', 'SUSPENDED'])
  status?: 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

  /** Pontos-base: 2000 = 20%. Teto de 50% por seguranca contra digitacao. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  commissionRateBps?: number;

  @IsOptional()
  @Matches(CODE_INPUT)
  referralCode?: string;

  @IsOptional()
  @Matches(CODE_INPUT)
  couponCode?: string;
}

export class AdminPayoutActionDto {
  @IsIn(['approve', 'reject', 'mark_paid'])
  action!: 'approve' | 'reject' | 'mark_paid';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

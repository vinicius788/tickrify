// ============================================================================
// CALIBRACAO DO MOTOR: ARQUIVO GERADO, NAO EDITAR A MAO
// ----------------------------------------------------------------------------
// Gerado por `scripts/replay-variants.ts --calibrate` com velas reais (Binance
// para cripto, Twelve Data para ouro e forex). Separado do plan-engine.ts para
// o motor continuar legivel e a calibracao poder ser regerada inteira.
// Chave: "<par>:<regime de volatilidade>" (low | normal | high).
//   STOP_MARGIN_P80: P80 de quanto o preco fura uma swing fractal e fecha de
//     volta, em ATR (margem do stop alem da invalidacao).
//   REACH_TABLE: chance de tocar um nivel a d ATR em N velas antes de andar
//     k ATR no sentido oposto, na ordem da grade ENGINE_RULES.reachGrid
//     (d, depois N, depois k); null = amostra pequena.
// Par ou regime ausente: margem de 0,25 ATR e WATCH sem probabilidade.
// ============================================================================

export const CALIBRATED_AT: string | null = null;

export const STOP_MARGIN_P80: Readonly<Record<string, number>> = {};

export const REACH_TABLE: Readonly<Record<string, readonly (number | null)[]>> = {};

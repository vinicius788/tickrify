/**
 * Template do e-mail de boas-vindas.
 *
 * Arquivo proprio para o HTML nao ficar dentro do MailService. HTML em tabelas
 * e estilos inline de proposito: Outlook e Gmail ignoram boa parte do CSS moderno.
 *
 * Regras:
 * - o cabecalho e o icone (`public/icon.png`, URL absoluta HTTPS) MAIS a palavra
 *   "Tickrify" em texto (05/10/2026). Antes era so a imagem do logo empilhado:
 *   o Gmail esconde imagem de remetente novo ate a pessoa clicar em "mostrar
 *   imagens", e o e-mail chegava sem marca nenhuma. Texto aparece sempre. Fixo
 *   em tickrify.com para nao quebrar quando FRONTEND_URL aponta para localhost;
 * - a regra do gratis vem de `free-quota.ts` (3 planos com BUY/SELL, WAIT nao
 *   conta, ate 10 no total), nunca escrita a mao;
 * - `firstName` e opcional; sem nome (ou nome inutilizavel) a saudacao some
 *   inteira, nunca aparece "undefined" nem virgula solta;
 * - todo texto vindo de fora passa por escapeHtml;
 * - versao em texto puro junto (clientes sem HTML e filtros de spam).
 */
import { FREE_SIGNAL_LIMIT, FREE_TOTAL_LIMIT } from '../../common/free-quota';
import { TRIAL_RULES } from '../../common/trial';

export const WELCOME_ICON_URL = 'https://tickrify.com/icon.png';

export const WELCOME_PREVIEW_TEXT =
  'Send a chart and get a buy or sell plan, an entry to wait for, or Wait, with the reason. The decision is always yours.';

/**
 * `trial`: a conta nova entra no trial de 3 dias (chave TRIAL_MODE ligada).
 * Sem ele, o texto da regra antiga (3 planos gratis), igual a antes.
 */
export function welcomeSubject(trial = false): string {
  return trial
    ? 'Welcome to Tickrify: your 3-day free trial is ready'
    : `Welcome to Tickrify: your ${FREE_SIGNAL_LIMIT} free trade plans are ready`;
}

function freeLine(trial: boolean): { title: string; text: string } {
  const [d1, d2] = TRIAL_RULES.dailyQuota;
  return trial
    ? {
        title: 'Your free trial',
        text: `3 days of use, with up to ${d1} analyses on your first day and ${d2} on each of the next two, within ${TRIAL_RULES.windowDays} days. No card needed.`,
      }
    : { title: COPY.freeTitle, text: COPY.free };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Devolve o primeiro nome pronto para exibir, ou null se nao houver um utilizavel. */
export function cleanFirstName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name || /^(undefined|null)$/i.test(name)) return null;
  return name;
}

function dashboardUrl(appUrl: string): string {
  // FRONTEND_URL mal formada (sem http/https) nao pode gerar link quebrado no e-mail.
  const base = /^https?:\/\/\S+$/.test(appUrl.trim()) ? appUrl.trim() : 'https://tickrify.com';
  return `${base.replace(/\/+$/, '')}/dashboard`;
}

/** O mesmo conteudo nas duas versoes (HTML e texto), para nunca divergirem. */
const COPY = {
  title: 'Welcome to Tickrify',
  intro:
    'Tickrify is a trading copilot. You send a screenshot of a chart, the AI reads it cold, and you get a second opinion before you enter.',
  getTitle: 'What every read gives you',
  get: [
    'Buy now or Sell now: entry, stop and target when there is a clean entry at the current price.',
    'Buy or Sell on pullback or on breakout: the price level to wait for and what cancels it.',
    'Wait: why there is nothing worth taking right now and, with market candles, the price that would change it.',
    'The reasoning behind it, so you can check it against your own view.',
  ],
  freeTitle: 'Your free plan',
  free: `${FREE_SIGNAL_LIMIT} free trade plans (BUY or SELL). WAIT reads do not count against them, up to ${FREE_TOTAL_LIMIT} analyses in total. No card needed.`,
  cta: 'Analyze your first chart',
  tip: 'Not sure where to start? Use the chart of the next trade you are already unsure about.',
  support: 'Questions? Reply to this email or write to support@tickrify.com.',
  disclaimer:
    'Tickrify is a second opinion, not financial advice and not a signal service. It never places orders. Trading involves risk, and the decision is always yours.',
} as const;

export function renderWelcomeText(params: { appUrl: string; firstName?: string | null; trial?: boolean }): string {
  const firstName = cleanFirstName(params.firstName);
  const free = freeLine(Boolean(params.trial));
  return [
    COPY.title,
    '',
    ...(firstName ? [`Hi ${firstName},`, ''] : []),
    COPY.intro,
    '',
    `${COPY.getTitle}:`,
    ...COPY.get.map((line) => `- ${line}`),
    '',
    `${free.title}: ${free.text}`,
    '',
    `${COPY.cta}: ${dashboardUrl(params.appUrl)}`,
    '',
    COPY.tip,
    '',
    COPY.support,
    '',
    COPY.disclaimer,
  ].join('\n');
}

export function renderWelcomeEmail(params: { appUrl: string; firstName?: string | null; trial?: boolean }): string {
  const firstName = cleanFirstName(params.firstName);
  const free = freeLine(Boolean(params.trial));
  const ctaUrl = dashboardUrl(params.appUrl);
  const font = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  const p = `margin:0 0 16px;font-family:${font};font-size:16px;line-height:26px;color:#33424f;`;
  const greeting = firstName ? `<p style="${p}">Hi ${escapeHtml(firstName)},</p>` : '';
  const items = COPY.get
    .map(
      (line) => `<tr>
                      <td valign="top" width="22" style="padding:0 0 10px;font-family:${font};font-size:16px;line-height:24px;color:#2eb872;font-weight:700;">&#10003;</td>
                      <td style="padding:0 0 10px;font-family:${font};font-size:15px;line-height:24px;color:#33424f;">${escapeHtml(line)}</td>
                    </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(COPY.title)}</title>
<style>
  @media only screen and (max-width:620px) {
    .outer { padding:20px 12px !important; }
    .card { padding:32px 22px !important; }
    .h1 { font-size:24px !important; line-height:30px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .card { background-color:#151b22 !important; }
    .h1, .strong { color:#f7f7f5 !important; }
    .body-text, .body-text td, .body-text p { color:#c3ccd5 !important; }
    .free-box { background-color:#1d2630 !important; border-color:#2a3542 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0b0f14;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b0f14;font-size:1px;line-height:1px;">${escapeHtml(WELCOME_PREVIEW_TEXT)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b0f14;">
  <tr>
    <td align="center" class="outer" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td style="padding:0 8px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:10px;">
                  <img src="${WELCOME_ICON_URL}" alt="" width="30" height="36" style="display:block;width:30px;height:36px;border:0;outline:none;text-decoration:none;">
                </td>
                <td valign="middle" style="font-family:${font};font-size:22px;line-height:28px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">Tickrify</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="card body-text" style="background-color:#ffffff;border-radius:16px;padding:40px;font-family:${font};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="h1" style="padding-bottom:20px;font-family:${font};font-size:28px;line-height:34px;font-weight:700;color:#0b0f14;">${escapeHtml(COPY.title)}</td>
              </tr>
              <tr>
                <td>
                  ${greeting}
                  <p style="${p}">${escapeHtml(COPY.intro)}</p>
                  <p class="strong" style="margin:8px 0 12px;font-family:${font};font-size:15px;line-height:22px;font-weight:700;color:#0b0f14;">${escapeHtml(COPY.getTitle)}</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${items}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding-top:12px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="free-box" style="background-color:#f2f7f4;border:1px solid #d5e8dc;border-radius:12px;">
                    <tr>
                      <td style="padding:16px 18px;font-family:${font};font-size:15px;line-height:23px;color:#33424f;">
                        <span class="strong" style="font-weight:700;color:#0b0f14;">${escapeHtml(free.title)}:</span> ${escapeHtml(free.text)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="left" style="padding-top:28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#2eb872" style="border-radius:10px;">
                        <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${font};font-size:16px;font-weight:700;color:#04240f;text-decoration:none;border-radius:10px;">${escapeHtml(COPY.cta)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding-top:24px;">
                  <p style="margin:0;font-family:${font};font-size:14px;line-height:22px;color:#5b6b7a;">${escapeHtml(COPY.tip)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 8px 0;font-family:${font};font-size:13px;line-height:20px;color:#a3b0bd;text-align:center;">
            ${escapeHtml(COPY.support).replace('support@tickrify.com', '<a href="mailto:support@tickrify.com" style="color:#a3b0bd;">support@tickrify.com</a>')}
          </td>
        </tr>
        <tr>
          <td style="padding:12px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:#8593a1;text-align:center;">
            ${escapeHtml(COPY.disclaimer)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

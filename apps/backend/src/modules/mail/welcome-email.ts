/**
 * Template do e-mail de boas-vindas.
 *
 * Arquivo proprio para o HTML nao ficar dentro do MailService. HTML em tabelas
 * e estilos inline de proposito: Outlook e Gmail ignoram boa parte do CSS moderno.
 *
 * Regras:
 * - a logo TEM que ser URL absoluta HTTPS publica (cliente de e-mail nao resolve
 *   caminho relativo). E o mesmo `public/logo.png` do frontend, servido em
 *   https://tickrify.com/logo.png, fixo aqui para nao quebrar quando
 *   FRONTEND_URL aponta para localhost;
 * - `firstName` e opcional; sem nome (ou nome inutilizavel) a saudacao some
 *   inteira, nunca aparece "undefined" nem virgula solta;
 * - todo texto vindo de fora passa por escapeHtml.
 */
import { FREE_SIGNAL_LIMIT } from '../../common/free-quota';

export const WELCOME_LOGO_URL = 'https://tickrify.com/logo.png';

export const WELCOME_PREVIEW_TEXT = 'Your Tickrify account is ready. Analyze your first chart.';

export function welcomeSubject(): string {
  return `Your ${FREE_SIGNAL_LIMIT} free Tickrify analyses are ready`;
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

export function renderWelcomeEmail(params: { appUrl: string; firstName?: string | null }): string {
  const firstName = cleanFirstName(params.firstName);
  // FRONTEND_URL mal formada (sem http/https) nao pode gerar link quebrado no e-mail.
  const base = /^https?:\/\/\S+$/.test(params.appUrl.trim()) ? params.appUrl.trim() : 'https://tickrify.com';
  const ctaUrl = `${base.replace(/\/+$/, '')}/dashboard`;
  const title = `Your ${FREE_SIGNAL_LIMIT} free analyses are ready`;
  const greeting = firstName
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#33424f;">Hi ${escapeHtml(firstName)},</p>`
    : '';
  const font = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  @media only screen and (max-width:620px) {
    .outer { padding:20px 12px !important; }
    .card { padding:32px 22px !important; }
    .h1 { font-size:24px !important; line-height:30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0b0f14;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b0f14;font-size:1px;line-height:1px;">${escapeHtml(WELCOME_PREVIEW_TEXT)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b0f14;">
  <tr>
    <td align="center" class="outer" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td class="card" style="background-color:#ffffff;border-radius:16px;padding:44px 40px;font-family:${font};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding-bottom:32px;">
                  <img src="${WELCOME_LOGO_URL}" alt="Tickrify" width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;">
                </td>
              </tr>
              <tr>
                <td class="h1" style="padding-bottom:20px;font-family:${font};font-size:28px;line-height:34px;font-weight:700;color:#0b0f14;">${escapeHtml(title)}</td>
              </tr>
              <tr>
                <td style="font-family:${font};">
                  ${greeting}
                  <p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#33424f;">Welcome to Tickrify.</p>
                  <p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#33424f;">You've got ${FREE_SIGNAL_LIMIT} free analyses to explore the platform. Upload a chart and get a second opinion on entry, stop, targets and risk before you decide.</p>
                  <p style="margin:0;font-size:16px;line-height:26px;color:#33424f;">Best way to start: run the next trade you're already unsure about.</p>
                </td>
              </tr>
              <tr>
                <td align="left" style="padding-top:32px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#2eb872" style="border-radius:10px;">
                        <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${font};font-size:16px;font-weight:700;color:#04240f;text-decoration:none;border-radius:10px;">Analyze a chart</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:#8593a1;text-align:center;">
            Tickrify provides analytical information and a second opinion, not financial advice. Trading involves risk. The decision is yours.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

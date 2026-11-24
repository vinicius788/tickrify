/**
 * E-mail de boas-vindas do afiliado aprovado (23/11/2026). Texto em ingles
 * aprovado pelo dono; as outras 5 linguas tem o mesmo sentido. Sai UMA vez
 * (AdminAudit `affiliate_welcome_sent`, ver AffiliatesService.sendWelcomeOnce).
 *
 * Nenhum numero escrito a mao: codigo, link, desconto, taxa, meses, carencia,
 * minimo de saque e preco semanal chegam da configuracao e do afiliado.
 * Arquivo proprio pelo mesmo motivo do welcome-email.ts: HTML de e-mail em
 * tabelas e estilos inline nao cabe no MailService.
 */
import { WELCOME_ICON_URL, cleanFirstName } from './welcome-email';

export const AFFILIATE_WELCOME_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'ja'] as const;
export type AffiliateWelcomeLanguage = (typeof AFFILIATE_WELCOME_LANGUAGES)[number];

export type AffiliateWelcomeValues = {
  firstName?: string | null;
  code: string;
  link: string;
  dashboardLink: string;
  discountPercent: number;
  ratePercent: number;
  months: number;
  holdDays: number;
  minPayoutUsd: number;
  /** Preco semanal em USD, em unidade normal (7.99). */
  weeklyPriceUsd: number;
};

type V = AffiliateWelcomeValues & { weeklyPrice: string };

type Copy = {
  locale: string;
  subject: string;
  greeting: (name: string | null) => string;
  welcome: string;
  codeLabel: string;
  linkLabel: string;
  audience: (v: V) => string;
  you: (v: V) => string;
  commissions: (v: V) => string;
  tipsTitle: string;
  tips: (v: V) => string[];
  questions: string;
  signTitle: string;
};

const COPY: Record<AffiliateWelcomeLanguage, Copy> = {
  en: {
    locale: 'en-US',
    subject: "You're now a Tickrify partner",
    greeting: (n) => (n ? `Hi ${n},` : 'Hi,'),
    welcome: "Welcome aboard. Your application was approved and you're now an official Tickrify partner.",
    codeLabel: 'Your coupon code:',
    linkLabel: 'Your link:',
    audience: (v) => `What your audience gets: ${v.discountPercent}% off their first payment with your code or link.`,
    you: (v) => `What you get: ${v.ratePercent}% of every payment from the people you bring, for ${v.months} months.`,
    commissions: (v) =>
      `Commissions are confirmed ${v.holdDays} days after each payment and can be withdrawn from ${v.minPayoutUsd} USD. Everything is tracked in your partner dashboard:`,
    tipsTitle: 'A few tips that work well:',
    tips: (v) => [
      'Show a real analysis you ran on a chart you trade.',
      `Mention the weekly plan (${v.weeklyPrice}): it's the easiest way to start.`,
      'Tickrify is an educational tool, not financial advice. Please never promise profits or results.',
    ],
    questions: 'Questions or ideas? Just reply to this email, it comes straight to me.',
    signTitle: 'Founder, Tickrify',
  },
  pt: {
    locale: 'pt-BR',
    subject: 'Você agora faz parte dos parceiros da Tickrify',
    greeting: (n) => (n ? `Olá, ${n},` : 'Olá,'),
    welcome: 'Boas-vindas. Seu pedido foi aprovado e agora você é parceiro oficial da Tickrify.',
    codeLabel: 'Seu cupom:',
    linkLabel: 'Seu link:',
    audience: (v) => `O que o seu público ganha: ${v.discountPercent}% de desconto no primeiro pagamento com o seu cupom ou link.`,
    you: (v) => `O que você ganha: ${v.ratePercent}% de cada pagamento das pessoas que você trouxer, por ${v.months} meses.`,
    commissions: (v) =>
      `As comissões são confirmadas ${v.holdDays} dias depois de cada pagamento e podem ser sacadas a partir de ${v.minPayoutUsd} USD. Tudo fica registrado no seu painel de parceiro:`,
    tipsTitle: 'Algumas dicas que funcionam bem:',
    tips: (v) => [
      'Mostre uma análise real que você fez num gráfico que você opera.',
      `Fale do plano semanal (${v.weeklyPrice}): é o jeito mais fácil de começar.`,
      'A Tickrify é uma ferramenta educacional, não é recomendação financeira. Nunca prometa lucro ou resultado.',
    ],
    questions: 'Dúvidas ou ideias? É só responder este e-mail, ele chega direto para mim.',
    signTitle: 'Fundador, Tickrify',
  },
  es: {
    locale: 'es-ES',
    subject: 'Ya eres partner de Tickrify',
    greeting: (n) => (n ? `Hola, ${n}:` : 'Hola:'),
    welcome: 'Te damos la bienvenida. Tu solicitud fue aprobada y ya eres partner oficial de Tickrify.',
    codeLabel: 'Tu código de cupón:',
    linkLabel: 'Tu enlace:',
    audience: (v) => `Lo que recibe tu audiencia: ${v.discountPercent}% de descuento en su primer pago con tu código o enlace.`,
    you: (v) => `Lo que recibes tú: ${v.ratePercent}% de cada pago de las personas que traigas, durante ${v.months} meses.`,
    commissions: (v) =>
      `Las comisiones se confirman ${v.holdDays} días después de cada pago y se pueden retirar a partir de ${v.minPayoutUsd} USD. Todo queda registrado en tu panel de partner:`,
    tipsTitle: 'Algunos consejos que funcionan bien:',
    tips: (v) => [
      'Muestra un análisis real que hiciste sobre un gráfico que operas.',
      `Menciona el plan semanal (${v.weeklyPrice}): es la forma más fácil de empezar.`,
      'Tickrify es una herramienta educativa, no asesoramiento financiero. Nunca prometas ganancias ni resultados.',
    ],
    questions: '¿Preguntas o ideas? Solo responde a este correo, me llega directamente a mí.',
    signTitle: 'Fundador, Tickrify',
  },
  fr: {
    locale: 'fr-FR',
    subject: 'Vous êtes maintenant partenaire Tickrify',
    greeting: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    welcome: 'Bienvenue parmi nous. Votre candidature a été acceptée et vous êtes désormais partenaire officiel de Tickrify.',
    codeLabel: 'Votre code promo :',
    linkLabel: 'Votre lien :',
    audience: (v) => `Ce que votre audience obtient : ${v.discountPercent} % de réduction sur son premier paiement avec votre code ou votre lien.`,
    you: (v) => `Ce que vous obtenez : ${v.ratePercent} % de chaque paiement des personnes que vous amenez, pendant ${v.months} mois.`,
    commissions: (v) =>
      `Les commissions sont confirmées ${v.holdDays} jours après chaque paiement et peuvent être retirées à partir de ${v.minPayoutUsd} USD. Tout est suivi dans votre tableau de bord partenaire :`,
    tipsTitle: 'Quelques conseils qui marchent bien :',
    tips: (v) => [
      'Montrez une vraie analyse faite sur un graphique que vous tradez.',
      `Parlez de l'offre hebdomadaire (${v.weeklyPrice}) : c'est la façon la plus simple de commencer.`,
      "Tickrify est un outil pédagogique, pas un conseil financier. Ne promettez jamais de gains ni de résultats.",
    ],
    questions: "Des questions ou des idées ? Répondez simplement à cet e-mail, il m'arrive directement.",
    signTitle: 'Fondateur, Tickrify',
  },
  de: {
    locale: 'de-DE',
    subject: 'Du bist jetzt Tickrify-Partner',
    greeting: (n) => (n ? `Hallo ${n},` : 'Hallo,'),
    welcome: 'willkommen an Bord. Deine Bewerbung wurde angenommen und du bist jetzt offizieller Tickrify-Partner.',
    codeLabel: 'Dein Gutscheincode:',
    linkLabel: 'Dein Link:',
    audience: (v) => `Was deine Community bekommt: ${v.discountPercent} % Rabatt auf die erste Zahlung mit deinem Code oder Link.`,
    you: (v) => `Was du bekommst: ${v.ratePercent} % jeder Zahlung der Personen, die du bringst, ${v.months} Monate lang.`,
    commissions: (v) =>
      `Provisionen werden ${v.holdDays} Tage nach jeder Zahlung bestätigt und können ab ${v.minPayoutUsd} USD ausgezahlt werden. Alles siehst du in deinem Partner-Dashboard:`,
    tipsTitle: 'Ein paar Tipps, die gut funktionieren:',
    tips: (v) => [
      'Zeig eine echte Analyse, die du auf einem Chart gemacht hast, den du tradest.',
      `Erwähne den Wochenplan (${v.weeklyPrice}): Das ist der einfachste Einstieg.`,
      'Tickrify ist ein Lernwerkzeug, keine Finanzberatung. Bitte versprich nie Gewinne oder Ergebnisse.',
    ],
    questions: 'Fragen oder Ideen? Antworte einfach auf diese E-Mail, sie kommt direkt bei mir an.',
    signTitle: 'Gründer, Tickrify',
  },
  ja: {
    locale: 'ja-JP',
    subject: 'Tickrify パートナーになりました',
    greeting: (n) => (n ? `${n} さん` : 'こんにちは'),
    welcome: 'ようこそ。申請が承認され、Tickrify の公式パートナーになりました。',
    codeLabel: 'あなたのクーポンコード:',
    linkLabel: 'あなたのリンク:',
    audience: (v) => `紹介した方の特典: あなたのコードまたはリンクで、初回のお支払いが ${v.discountPercent}% オフになります。`,
    you: (v) => `あなたの報酬: 紹介した方の毎回のお支払いの ${v.ratePercent}% を ${v.months} か月間受け取れます。`,
    commissions: (v) =>
      `コミッションは各お支払いの ${v.holdDays} 日後に確定し、${v.minPayoutUsd} USD から出金できます。すべてパートナーダッシュボードで確認できます:`,
    tipsTitle: 'うまくいくコツ:',
    tips: (v) => [
      '実際にトレードしているチャートで行った本物の分析を見せてください。',
      `週間プラン (${v.weeklyPrice}) を紹介してください。いちばん始めやすいプランです。`,
      'Tickrify は学習用のツールで、投資助言ではありません。利益や結果を約束しないでください。',
    ],
    questions: '質問やアイデアがあれば、このメールに返信してください。私に直接届きます。',
    signTitle: 'Tickrify 創業者',
  },
};

export function affiliateWelcomeLanguage(value: unknown): AffiliateWelcomeLanguage {
  return AFFILIATE_WELCOME_LANGUAGES.includes(value as AffiliateWelcomeLanguage) ? (value as AffiliateWelcomeLanguage) : 'en';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function withPrice(copy: Copy, values: AffiliateWelcomeValues): V {
  let weeklyPrice = `${values.weeklyPriceUsd} USD`;
  try {
    weeklyPrice = new Intl.NumberFormat(copy.locale, { style: 'currency', currency: 'USD' }).format(values.weeklyPriceUsd);
  } catch {
    /* sem Intl completo: fica o valor com USD */
  }
  return { ...values, weeklyPrice };
}

const FONT = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export function renderAffiliateWelcome(language: AffiliateWelcomeLanguage, values: AffiliateWelcomeValues) {
  const copy = COPY[language];
  const v = withPrice(copy, values);
  const name = cleanFirstName(values.firstName)?.split(' ')[0] ?? null;
  const tips = copy.tips(v);

  const text = [
    copy.greeting(name),
    '',
    copy.welcome,
    '',
    `${copy.codeLabel} ${v.code}`,
    `${copy.linkLabel} ${v.link}`,
    '',
    copy.audience(v),
    copy.you(v),
    `${copy.commissions(v)} ${v.dashboardLink}`,
    '',
    copy.tipsTitle,
    ...tips.map((tip) => `- ${tip}`),
    '',
    copy.questions,
    '',
    'Vinícius',
    copy.signTitle,
  ].join('\n');

  const p = (html: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:#1f2a36;">${html}</p>`;
  const a = (url: string) => `<a href="${escapeHtml(url)}" target="_blank" style="color:#1a7f4b;">${escapeHtml(url)}</a>`;
  const html = `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.welcome)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
          <tr>
            <td valign="middle" style="padding-right:8px;"><img src="${WELCOME_ICON_URL}" alt="" width="20" height="24" style="display:block;width:20px;height:24px;border:0;"></td>
            <td valign="middle" style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:#0b0f14;">Tickrify</td>
          </tr>
        </table>
        ${p(escapeHtml(copy.greeting(name)))}
        ${p(escapeHtml(copy.welcome))}
        ${p(`${escapeHtml(copy.codeLabel)} <b style="font-size:18px;letter-spacing:1px;">${escapeHtml(v.code)}</b><br>${escapeHtml(copy.linkLabel)} ${a(v.link)}`)}
        ${p(`${escapeHtml(copy.audience(v))}<br>${escapeHtml(copy.you(v))}`)}
        ${p(`${escapeHtml(copy.commissions(v))} ${a(v.dashboardLink)}`)}
        ${p(escapeHtml(copy.tipsTitle))}
        <ul style="margin:0 0 16px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:26px;color:#1f2a36;">
          ${tips.map((tip) => `<li style="margin:0 0 6px;">${escapeHtml(tip)}</li>`).join('\n          ')}
        </ul>
        ${p(escapeHtml(copy.questions))}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
          <tr>
            <td valign="middle" style="padding-right:12px;"><img src="${WELCOME_ICON_URL}" alt="Tickrify" width="30" height="36" style="display:block;width:30px;height:36px;border:0;"></td>
            <td valign="middle" style="font-family:${FONT};font-size:15px;line-height:21px;color:#1f2a36;"><b>Vinícius</b><br>${escapeHtml(copy.signTitle)}</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text };
}

import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-10">
    <h2 className="mb-3 text-lg font-bold text-[var(--text-primary)]">{title}</h2>
    <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
  </section>
);

const PrivacyPolicyPage = () => {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="container max-w-3xl py-16">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao início
        </Link>

        <header className="mb-12">
          <p className="font-terminal text-xs uppercase tracking-widest text-[var(--accent-green)] mb-2">
            Legal
          </p>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Política de Privacidade</h1>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            Última atualização: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </header>

        <Section title="1. Quem somos">
          <p>
            A <strong className="text-[var(--text-primary)]">Tickrify</strong> é uma plataforma de análise técnica de gráficos
            com inteligência artificial, operada por pessoa física ou jurídica brasileira. Para dúvidas sobre esta
            política, entre em contato pelo e-mail{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>.
          </p>
        </Section>

        <Section title="2. Dados que coletamos">
          <p>Coletamos apenas os dados necessários para o funcionamento da plataforma:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Dados de cadastro:</strong> nome, endereço de e-mail e senha (gerenciados pelo Clerk, nosso provedor de autenticação).</li>
            <li><strong className="text-[var(--text-primary)]">Dados de pagamento:</strong> informações de cobrança processadas pelo Stripe. A Tickrify não armazena dados de cartão de crédito.</li>
            <li><strong className="text-[var(--text-primary)]">Imagens enviadas:</strong> gráficos que você faz upload para análise. São armazenados para exibir o histórico de análises.</li>
            <li><strong className="text-[var(--text-primary)]">Dados de uso:</strong> número de análises realizadas, plano contratado, saldo de Ticks e histórico de transações.</li>
            <li><strong className="text-[var(--text-primary)]">Dados técnicos:</strong> endereço IP, tipo de dispositivo e navegador, coletados automaticamente para segurança e diagnóstico.</li>
          </ul>
        </Section>

        <Section title="3. Como usamos seus dados">
          <p>Usamos seus dados para:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li>Fornecer e melhorar os serviços da plataforma;</li>
            <li>Processar pagamentos e gerenciar assinaturas;</li>
            <li>Enviar comunicações transacionais (confirmações de pagamento, alertas de saldo);</li>
            <li>Garantir a segurança da conta e prevenir fraudes;</li>
            <li>Cumprir obrigações legais e regulatórias.</li>
          </ul>
          <p className="mt-3">
            Não vendemos, alugamos nem compartilhamos seus dados pessoais com terceiros para fins de marketing.
          </p>
        </Section>

        <Section title="4. Compartilhamento de dados">
          <p>Seus dados podem ser compartilhados apenas com fornecedores essenciais ao funcionamento da plataforma:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Clerk</strong> — autenticação e gerenciamento de contas;</li>
            <li><strong className="text-[var(--text-primary)]">Stripe</strong> — processamento de pagamentos;</li>
            <li><strong className="text-[var(--text-primary)]">Provedor de IA</strong> — processamento das imagens de gráficos para geração de análises;</li>
            <li><strong className="text-[var(--text-primary)]">Supabase</strong> — banco de dados e armazenamento de arquivos;</li>
            <li><strong className="text-[var(--text-primary)]">Render</strong> — infraestrutura de servidores.</li>
          </ul>
          <p className="mt-3">
            Todos os fornecedores são contratualmente obrigados a proteger seus dados e utilizá-los apenas para os fins
            especificados.
          </p>
        </Section>

        <Section title="5. Armazenamento e segurança">
          <p>
            Seus dados são armazenados em servidores seguros. Utilizamos criptografia em trânsito (TLS/HTTPS) e
            em repouso. O acesso aos dados é restrito a sistemas e pessoas que precisam deles para operar a plataforma.
          </p>
          <p>
            Imagens de gráficos enviadas para análise são armazenadas em serviço de armazenamento seguro na nuvem.
            Você pode solicitar a exclusão a qualquer momento.
          </p>
        </Section>

        <Section title="6. Seus direitos (LGPD)">
          <p>
            Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você tem os seguintes direitos em relação
            aos seus dados pessoais:
          </p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Acesso:</strong> confirmar a existência de tratamento e acessar seus dados;</li>
            <li><strong className="text-[var(--text-primary)]">Correção:</strong> corrigir dados incompletos, inexatos ou desatualizados;</li>
            <li><strong className="text-[var(--text-primary)]">Exclusão:</strong> solicitar a exclusão de dados tratados com seu consentimento;</li>
            <li><strong className="text-[var(--text-primary)]">Portabilidade:</strong> solicitar a portabilidade dos seus dados para outro fornecedor;</li>
            <li><strong className="text-[var(--text-primary)]">Revogação do consentimento:</strong> retirar consentimento a qualquer momento;</li>
            <li><strong className="text-[var(--text-primary)]">Oposição:</strong> se opor a tratamento realizado em descumprimento da LGPD.</li>
          </ul>
          <p className="mt-3">
            Para exercer seus direitos, envie um e-mail para{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>. Respondemos em até 15 dias úteis.
          </p>
        </Section>

        <Section title="7. Retenção de dados">
          <p>
            Mantemos seus dados enquanto sua conta estiver ativa. Após o cancelamento da conta, dados pessoais são
            excluídos em até 90 dias, exceto quando a retenção for obrigatória por lei (ex.: dados fiscais, conforme
            legislação tributária brasileira).
          </p>
        </Section>

        <Section title="8. Cookies e rastreamento">
          <p>
            A Tickrify utiliza cookies essenciais para o funcionamento da autenticação e sessão. Não utilizamos cookies
            de rastreamento para publicidade. Dados de sessão são gerenciados pelo Clerk.
          </p>
        </Section>

        <Section title="9. Crianças e adolescentes">
          <p>
            Nossa plataforma é destinada a maiores de 18 anos. Não coletamos intencionalmente dados de menores de
            idade. Se identificarmos que uma conta foi criada por menor, a excluiremos imediatamente.
          </p>
        </Section>

        <Section title="10. Alterações nesta política">
          <p>
            Podemos atualizar esta política periodicamente. Em caso de alterações relevantes, notificaremos por
            e-mail ou aviso na plataforma com antecedência mínima de 15 dias. O uso continuado após a notificação
            implica aceitação das alterações.
          </p>
        </Section>

        <Section title="11. Contato e encarregado de dados (DPO)">
          <p>
            Para questões relacionadas a esta política ou ao tratamento dos seus dados pessoais, entre em contato:
          </p>
          <p className="mt-2">
            <strong className="text-[var(--text-primary)]">E-mail:</strong>{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>
          </p>
        </Section>

        <div className="mt-12 border-t border-[var(--border-subtle)] pt-8 text-xs text-[var(--text-muted)]">
          <p>
            Esta política é regida pelas leis da República Federativa do Brasil. Qualquer disputa relacionada ao
            tratamento de dados pessoais será submetida à jurisdição brasileira competente.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;

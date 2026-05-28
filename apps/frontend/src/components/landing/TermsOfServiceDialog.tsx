import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const TermsOfServiceDialog = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-primary transition-colors">
          Termos de Serviço
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Termos de Serviço — Tickrify (versão final completa)</DialogTitle>
          <DialogDescription>Data de vigência: 19 de setembro de 2025</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-2 space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-semibold">1. Aceitação dos Termos</h3>
            <p>
              Ao acessar ou usar o site, extensão ou serviços da Tickrify, você confirma que leu,
              entendeu e concorda com estes Termos de Serviço, com a Política de Privacidade e com
              todas as políticas associadas.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">2. Descrição do Serviço</h3>
            <p>
              A Tickrify fornece ferramentas de análise de gráficos, leitura de tela e indicações
              geradas por IA para auxiliar na identificação de possíveis pontos de compra e venda.
              Este serviço é oferecido para fins educacionais e informativos. Apesar de a
              plataforma poder indicar sinais de compra e venda, tais indicações não constituem
              aconselhamento financeiro personalizado, recomendação de investimento, oferta ou
              garantia de lucro.
            </p>
            <p>
              Decisões de negociação são de responsabilidade exclusiva do usuário; consulte um
              profissional financeiro licenciado antes de tomar decisões.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">3. Requisitos de Elegibilidade</h3>
            <p>Uso permitido somente para maiores de 18 anos ou conforme a legislação da sua região.</p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">4. Contas de Usuário</h3>
            <p>Ao criar uma conta, você concorda em:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>fornecer informações corretas e atualizadas;</li>
              <li>manter suas credenciais seguras;</li>
              <li>assumir responsabilidade total por qualquer atividade na sua conta.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">5. Conduta do Usuário</h3>
            <p>É proibido utilizar a Tickrify para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>atividades ilegais;</li>
              <li>acessar dados de terceiros;</li>
              <li>distribuir malware ou código malicioso;</li>
              <li>tentar violar, quebrar ou comprometer a segurança da plataforma;</li>
              <li>engenharia reversa, scraping ou acessos não autorizados a sistemas e APIs.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">6. Propriedade Intelectual</h3>
            <p>
              Todo código, design, algoritmos, marca, software, extensões e conteúdo pertencem à
              Tickrify. É proibido copiar, clonar, redistribuir ou modificar qualquer conteúdo sem
              autorização.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">7. Aviso de Não-Aconselhamento Financeiro</h3>
            <p>
              Todas as informações, análises e sinais fornecidos pela Tickrify são exclusivamente
              educacionais. Mesmo quando a IA indicar possíveis operações, isso não constitui:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>consultoria financeira;</li>
              <li>recomendação profissional;</li>
              <li>serviço regulamentado;</li>
              <li>garantia de lucro.</li>
            </ul>
            <p>Trading envolve risco real. Procure profissionais licenciados.</p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">8. Limitação de Responsabilidade</h3>
            <p>
              A Tickrify não será responsável por danos diretos, indiretos, financeiros ou
              consequenciais decorrentes do uso da plataforma ou decisões tomadas com base nela. O
              risco é totalmente do usuário.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">9. Privacidade e Segurança de Dados</h3>
            <p>
              A Tickrify protege e criptografa dados sensíveis, incluindo imagens analisadas.
              Consulte nossa Política de Privacidade para saber como coletamos, usamos e armazenamos
              informações.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">10. Links e Serviços de Terceiros</h3>
            <p>
              A Tickrify não se responsabiliza por conteúdo, segurança ou práticas de sites e
              serviços externos.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">11. Modificação dos Termos</h3>
            <p>
              A Tickrify pode atualizar estes Termos sem aviso prévio. O uso contínuo implica
              aceitação das alterações.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">12. Rescisão</h3>
            <p>
              A Tickrify pode suspender ou encerrar contas por violação dos Termos, uso abusivo ou
              atividade suspeita.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">13. Lei Aplicável</h3>
            <p>Estes Termos seguem as leis da jurisdição onde a Tickrify opera.</p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">14. Contato</h3>
            <p>
              E-mail:{" "}
              <a href="mailto:tickrify@gmail.com" className="text-primary hover:underline">
                tickrify@gmail.com
              </a>
            </p>
            <p>
              Site:{" "}
              <a
                href="https://tickrify.com"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                https://tickrify.com
              </a>
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">
              15. Declaração Regulatória — Jurisdições com Restrições
            </h3>
            <p>
              A Tickrify não é licenciada por órgãos reguladores financeiros, incluindo, mas não se
              limitando a:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Hong Kong SFC (Securities and Futures Commission)</li>
              <li>CSRC (China Securities Regulatory Commission)</li>
              <li>Qualquer autoridade reguladora da China Continental</li>
            </ul>
            <p>
              As ferramentas são educacionais e não configuram oferta, solicitação ou consultoria
              profissional em mercados regulamentados.
            </p>
            <p>
              Usuários localizados em regiões com restrições devem cumprir as leis locais e buscar
              profissionais financeiros licenciados.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">16. Política Sem Reembolso</h3>
            <p>
              Todas as compras são finais e não reembolsáveis. Ao adquirir um produto digital, você
              concorda que não tem direito a cancelamento, estorno ou crédito.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TermsOfServiceDialog;

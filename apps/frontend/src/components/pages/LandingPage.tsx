import Header from '@/components/landing/Header';
import FoundingTraderBanner from '@/components/landing/FoundingTraderBanner';
import HeroSection from '@/components/landing/HeroSection';
import AnalysisPanelPreviewSection from '@/components/landing/AnalysisPanelPreviewSection';
import SocialProof from '@/components/landing/SocialProof';
import FeaturesSection from '@/components/landing/FeaturesSection';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import PricingSection from '@/components/landing/PricingSection';
import FaqSection from '@/components/landing/FaqSection';
import Footer from '@/components/landing/Footer';
import RecentTickerSection from '@/components/landing/RecentTickerSection';
import RecentAnalysesSection from '@/components/landing/RecentAnalysesSection';
import FinalCtaSection from '@/components/landing/FinalCtaSection';
import { useSeo } from '@/hooks/useSeo';

const LandingPage = () => {
  // O home já herdava title e description do index.html; o que faltava era o
  // canonical. Sem ele, '/', '/?utm_source=blog...' e cada variação de UTM que
  // o próprio blog gera contam como URLs distintas.
  useSeo({
    title: 'Tickrify — AI Chart Analysis for Traders',
    description:
      'Paste your chart and AI reads the entry, stop, targets and risk — a second opinion that confirms or kills your read. 3 free analyses, no card needed.',
    path: '/',
  });

  return (
    <div className="landing-shell grain-overlay grid-background flex min-h-screen flex-col overflow-x-clip bg-[var(--bg)]">
      <FoundingTraderBanner />
      <Header />
      <main className="flex-grow">
        <HeroSection />
        <RecentTickerSection />
        <SocialProof />
        <HowItWorksSection />
        <FeaturesSection />
        <AnalysisPanelPreviewSection />
        <RecentAnalysesSection />
        <PricingSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;

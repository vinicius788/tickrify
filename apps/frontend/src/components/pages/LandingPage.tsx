import SiteLayout from '@/components/layout/SiteLayout';
import FoundingTraderBanner from '@/components/landing/FoundingTraderBanner';
import HeroSection from '@/components/landing/HeroSection';
import SocialProof from '@/components/landing/SocialProof';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import PlatformDemoSection from '@/components/landing/PlatformDemoSection';
import FeaturesSection from '@/components/landing/FeaturesSection';
import RecentAnalysesSection from '@/components/landing/RecentAnalysesSection';
import PricingSection from '@/components/landing/PricingSection';
import FaqSection from '@/components/landing/FaqSection';
import FinalCtaSection from '@/components/landing/FinalCtaSection';
import { seoFor, useSeo } from '@/hooks/useSeo';

/**
 * Ordem das seções: escuro, claro, escuro, claro, escuro.
 *
 * A alternância existe para dar ritmo. A página antiga eram nove seções pretas
 * seguidas, e era metade do motivo de ela cansar antes de vender.
 */
const LandingPage = () => {
  // O home já herdava title e description do index.html; o que faltava era o
  // canonical. Sem ele, '/', '/?utm_source=blog...' e cada variação de UTM que
  // o próprio blog gera contam como URLs distintas.
  useSeo(seoFor('/'));

  return (
    <SiteLayout>
      <FoundingTraderBanner />
      <HeroSection />
      <SocialProof />
      <HowItWorksSection />
      <PlatformDemoSection />
      <FeaturesSection />
      <RecentAnalysesSection />
      <PricingSection />
      <FaqSection />
      <FinalCtaSection />
    </SiteLayout>
  );
};

export default LandingPage;

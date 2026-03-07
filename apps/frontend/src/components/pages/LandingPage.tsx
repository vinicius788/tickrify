import Header from '@/components/landing/Header';
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

const LandingPage = () => {
  return (
    <div className="grain-overlay grid-background flex min-h-screen flex-col bg-[var(--bg-base)]">
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

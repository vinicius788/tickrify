import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { SignInButton } from "@clerk/clerk-react";

const HeroSection = () => {
  const candles = Array.from({ length: 52 }, (_, i) => {
    const base = 42180;
    const wave = Math.sin(i / 4) * 34 + Math.sin(i / 9) * 22;
    const trend =
      i < 12 ? i * 5
      : i < 24 ? 60 - (i - 12) * 8
      : i < 36 ? -36 + (i - 24) * 10
      : 84 - (i - 36) * 4;

    const close = base + wave + trend;
    const open = close - Math.sin(i * 1.5) * 16;
    const high = Math.max(open, close) + 10 + ((i * 7) % 8);
    const low = Math.min(open, close) - 10 - ((i * 5) % 7);
    const volume = 40 + Math.abs(Math.sin(i / 3)) * 52 + ((i * 13) % 18);

    return {
      open,
      high,
      low,
      close,
      volume,
    };
  });

  const maxPrice = Math.max(...candles.map((c) => c.high));
  const minPrice = Math.min(...candles.map((c) => c.low));
  const pricePadding = (maxPrice - minPrice) * 0.08;
  const topPrice = maxPrice + pricePadding;
  const bottomPrice = minPrice - pricePadding;
  const maxVolume = Math.max(...candles.map((c) => c.volume));

  const PRICE_TOP = 7;
  const PRICE_BOTTOM = 72;
  const VOLUME_TOP = 78;
  const VOLUME_BOTTOM = 95;

  const scalePrice = (price: number) =>
    PRICE_TOP + ((topPrice - price) / (topPrice - bottomPrice)) * (PRICE_BOTTOM - PRICE_TOP);

  const scaleVolume = (volume: number) =>
    VOLUME_BOTTOM - (volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);

  const movingAverage = candles.map((_, index) => {
    const start = Math.max(0, index - 6);
    const window = candles.slice(start, index + 1);
    return window.reduce((sum, candle) => sum + candle.close, 0) / window.length;
  });

  const maPath = movingAverage
    .map((value, index) => {
      const x = ((index + 0.5) / candles.length) * 100;
      const y = scalePrice(value);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`;
    })
    .join(" ");

  const firstOpen = candles[0].open;
  const lastClose = candles[candles.length - 1].close;
  const deltaPercent = ((lastClose - firstOpen) / firstOpen) * 100;
  const deltaIsUp = deltaPercent >= 0;

  const priceLevels = Array.from({ length: 5 }, (_, idx) => (
    topPrice - ((topPrice - bottomPrice) * idx) / 4
  ));

  const formatPrice = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

  return (
    <section className="container relative flex flex-col items-center justify-center py-20 md:py-32">
      <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
          Análise de Trading com IA de Nível Institucional
        </h1>
        <p className="mt-6 text-lg text-muted-foreground md:text-xl">
          Sinais precisos, gestão de risco profissional, educação contínua.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <Button size="lg" className="w-full sm:w-auto">
              Começar Análise Gratuita <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </SignInButton>
          <Link to="/demo">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              Ver Demo
            </Button>
          </Link>
        </div>
      </motion.div>

      <motion.div 
        className="relative mt-16 w-full max-w-4xl"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.2 }}
      >
        <div className="aspect-video w-full rounded-xl bg-muted/30 p-2 border border-border/50 shadow-2xl shadow-primary/10">
            <div className="w-full h-full rounded-lg border border-border/30 bg-[#050b1f] overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tracking-wide">BTC/USD</span>
                  <span className="text-xs rounded bg-background/70 px-2 py-0.5 text-muted-foreground">1H</span>
                </div>
                <div className={`text-xs font-mono ${deltaIsUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {formatPrice(lastClose)} ({deltaIsUp ? "+" : ""}{deltaPercent.toFixed(2)}%)
                </div>
              </div>

              <div className="relative h-[calc(100%-45px)]">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                  <defs>
                    <linearGradient id="heroMarketBg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#07122f" />
                      <stop offset="100%" stopColor="#040916" />
                    </linearGradient>
                    <linearGradient id="heroVolumeUp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.15" />
                    </linearGradient>
                    <linearGradient id="heroVolumeDown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fb7185" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="#fb7185" stopOpacity="0.15" />
                    </linearGradient>
                  </defs>

                  <rect x="0" y="0" width="100" height="100" fill="url(#heroMarketBg)" />

                  {Array.from({ length: 7 }).map((_, idx) => {
                    const y = PRICE_TOP + ((PRICE_BOTTOM - PRICE_TOP) * idx) / 6;
                    return (
                      <line
                        key={`grid-y-${idx}`}
                        x1="0"
                        y1={y}
                        x2="100"
                        y2={y}
                        stroke="rgba(148, 163, 184, 0.14)"
                        strokeWidth="0.15"
                      />
                    );
                  })}

                  {Array.from({ length: 14 }).map((_, idx) => {
                    const x = (100 * idx) / 13;
                    return (
                      <line
                        key={`grid-x-${idx}`}
                        x1={x}
                        y1={PRICE_TOP}
                        x2={x}
                        y2={PRICE_BOTTOM}
                        stroke="rgba(148, 163, 184, 0.1)"
                        strokeWidth="0.12"
                      />
                    );
                  })}

                  <path
                    d={maPath}
                    fill="none"
                    stroke="rgba(56, 189, 248, 0.9)"
                    strokeWidth="0.35"
                    strokeLinecap="round"
                  />

                  {candles.map((candle, index) => {
                    const x = ((index + 0.5) / candles.length) * 100;
                    const bodyWidth = 100 / candles.length * 0.58;
                    const openY = scalePrice(candle.open);
                    const closeY = scalePrice(candle.close);
                    const highY = scalePrice(candle.high);
                    const lowY = scalePrice(candle.low);
                    const isUp = candle.close >= candle.open;
                    const color = isUp ? "#34d399" : "#fb7185";

                    return (
                      <g key={`candle-${index}`}>
                        <line
                          x1={x}
                          y1={highY}
                          x2={x}
                          y2={lowY}
                          stroke={color}
                          strokeWidth="0.2"
                        />
                        <rect
                          x={x - bodyWidth / 2}
                          y={Math.min(openY, closeY)}
                          width={bodyWidth}
                          height={Math.max(Math.abs(openY - closeY), 0.7)}
                          fill={color}
                          rx="0.08"
                        />
                      </g>
                    );
                  })}

                  <line
                    x1="0"
                    y1={scalePrice(lastClose)}
                    x2="100"
                    y2={scalePrice(lastClose)}
                    stroke={deltaIsUp ? "rgba(52, 211, 153, 0.7)" : "rgba(251, 113, 133, 0.7)"}
                    strokeWidth="0.14"
                    strokeDasharray="0.8 0.8"
                  />

                  {candles.map((candle, index) => {
                    const x = ((index + 0.5) / candles.length) * 100;
                    const barWidth = 100 / candles.length * 0.52;
                    const y = scaleVolume(candle.volume);
                    const isUp = candle.close >= candle.open;
                    return (
                      <rect
                        key={`vol-${index}`}
                        x={x - barWidth / 2}
                        y={y}
                        width={barWidth}
                        height={VOLUME_BOTTOM - y}
                        fill={isUp ? "url(#heroVolumeUp)" : "url(#heroVolumeDown)"}
                        rx="0.08"
                      />
                    );
                  })}
                </svg>

                <div className="pointer-events-none absolute right-2 top-2 space-y-1 text-[10px] font-mono text-muted-foreground/85">
                  {priceLevels.map((value, index) => (
                    <div key={`price-level-${index}`}>${formatPrice(value)}</div>
                  ))}
                </div>

                <div className="pointer-events-none absolute bottom-1 left-3 right-3 flex justify-between text-[10px] text-muted-foreground/70">
                  <span>09:00</span>
                  <span>12:00</span>
                  <span>15:00</span>
                  <span>18:00</span>
                </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
};

export default HeroSection;

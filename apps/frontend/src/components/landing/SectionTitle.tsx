type SectionTitleProps = {
  label: string;
  title: string;
  highlight: string;
  align?: 'left' | 'center';
  subtitle?: string;
  highlightClassName?: string;
};

export const SectionTitle = ({
  label,
  title,
  highlight,
  align = 'left',
  subtitle,
  highlightClassName = '',
}: SectionTitleProps) => {
  const isCentered = align === 'center';

  return (
    <div className={`mb-10 ${isCentered ? 'mx-auto text-center' : ''}`}>
      <p className="font-terminal text-[0.7rem] font-medium uppercase tracking-[0.12em] text-[var(--text-accent)]">
        {label}
      </p>
      <h2
        className="mt-3 text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.04] tracking-[-0.03em] text-[var(--text-primary)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title} <span className={`hero-highlight ${highlightClassName}`.trim()}>{highlight}</span>
      </h2>
      {subtitle ? (
        <p
          className={`mt-4 max-w-[560px] text-[0.95rem] leading-7 text-[var(--text-secondary)] ${
            isCentered ? 'mx-auto' : ''
          }`}
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
};

export default SectionTitle;

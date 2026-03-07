type SectionTitleProps = {
  label: string;
  title: string;
  highlight: string;
  align?: 'left' | 'center';
  subtitle?: string;
};

export const SectionTitle = ({ label, title, highlight, align = 'left', subtitle }: SectionTitleProps) => {
  const isCentered = align === 'center';

  return (
    <div className={`mb-10 ${isCentered ? 'mx-auto text-center' : ''}`}>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#00D26A',
          marginBottom: '10px',
        }}
      >
        {label}
      </p>
      <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(1.6rem, 2.2vw, 2rem)', lineHeight: 1.3, color: '#E8ECF4' }}>
        {title} <span className="text-[var(--signal-buy)]">{highlight}</span>
      </h2>
      {subtitle ? (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.875rem',
            color: '#8892A4',
            marginTop: '10px',
            lineHeight: 1.6,
            maxWidth: '480px',
            ...(isCentered ? { margin: '10px auto 0' } : {}),
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
};

export default SectionTitle;

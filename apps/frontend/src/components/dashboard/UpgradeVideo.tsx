import { useRef } from 'react';
import { track } from '@/lib/analytics';

/**
 * Filme 04 (multi-timeframe, 20 s) no paywall e na janela de upgrade.
 *
 * E o recurso que so o assinante tem (grafico de entrada + ate 2 tempos
 * maiores), entao mostra o que a assinatura destrava em vez de repetir preco.
 * O arquivo e o mesmo da /blog/how-tickrify-works/ (servido pelo Vercel como
 * estatico, ~1 MB) e so baixa quando a pessoa aperta play (`preload="none"`).
 * Componente proprio porque aparece em dois lugares (paywall e janela).
 *
 * Eventos: `upgrade_video_played` no primeiro play e `upgrade_video_completed`
 * quando chega ao fim, os dois com `surface` para separar paywall e janela.
 */
export const UPGRADE_VIDEO_SRC = '/blog/how-tickrify-works/film04.mp4';
export const UPGRADE_VIDEO_POSTER = '/blog/how-tickrify-works/film04.jpg';

interface UpgradeVideoProps {
  surface: 'locked' | 'upgrade_modal';
  caption: string;
}

const UpgradeVideo = ({ surface, caption }: UpgradeVideoProps) => {
  const played = useRef(false);
  const completed = useRef(false);
  return (
    <figure className="m-0">
      <video
        src={UPGRADE_VIDEO_SRC}
        poster={UPGRADE_VIDEO_POSTER}
        controls
        playsInline
        preload="none"
        width={1280}
        height={720}
        className="block h-auto w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--media-bg)]"
        onPlay={() => {
          if (played.current) return;
          played.current = true;
          track('upgrade_video_played', { surface, film: '04' });
        }}
        onEnded={() => {
          if (completed.current) return;
          completed.current = true;
          track('upgrade_video_completed', { surface, film: '04' });
        }}
      />
      <figcaption className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{caption}</figcaption>
    </figure>
  );
};

export default UpgradeVideo;

import { useState } from 'react';
import { Track } from '../types';

export function MobileCollectionArtwork({ tracks, icon: Icon }: { tracks: Track[]; icon: React.ComponentType<{ size?: number }> }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const covers = [...new Set(tracks.map(track => track.thumb).filter((src): src is string => !!src && !failed.has(src)))].slice(0, 4);
  const tiles = covers.length > 1 ? Array.from({ length: 4 }, (_, index) => covers[index % covers.length]) : covers;
  return <span className="dmex-mobile-collection-art" data-cover-count={covers.length} aria-hidden="true">
    {tiles.length ? <span className={'dmex-mobile-cover-grid' + (tiles.length === 1 ? ' is-single' : '')}>
      {tiles.map((src, index) => <img key={`${index}:${src}`} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(previous => new Set(previous).add(src))} />)}
    </span> : <Icon size={28} />}
    {!!tiles.length && <span className="dmex-mobile-collection-badge"><Icon size={14} /></span>}
  </span>;
}

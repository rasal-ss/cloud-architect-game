import type { ServiceKind } from '@cloud-architect/content';
import { CATEGORY_COLOR, KIND_GLYPH, catalogue } from '../lib/catalogue';

export function Glyph({ kind, size = 'md' }: { kind: ServiceKind; size?: 'md' | 'lg' }) {
  const color = CATEGORY_COLOR[catalogue.get(kind).category];
  return (
    <span className={`glyph glyph-${size}`} style={{ ['--c' as string]: color }} aria-hidden>
      {KIND_GLYPH[kind]}
    </span>
  );
}

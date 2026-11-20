import type { ServiceKind } from '@cloud-architect/content';
import { CATEGORY_COLOR, KIND_GLYPH, catalogue, money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { DRAG_MIME } from './Canvas';

const ORDER: ServiceKind[] = ['cloudfront', 's3', 'alb', 'ec2', 'asg', 'elasticache', 'rds', 'rds_replica'];

export function Palette() {
  const level = useGame((s) => s.level);
  const addService = useGame((s) => s.addService);
  const nodeCount = useGame((s) => s.nodes.length);
  if (!level) return null;
  const kinds = ORDER.filter((k) => (level.palette as readonly ServiceKind[]).includes(k));

  return (
    <aside className="palette" aria-label="Service palette">
      <h3>Services</h3>
      <p className="muted small">Drag onto the canvas, or click to add.</p>
      {kinds.map((kind) => {
        const spec = catalogue.get(kind);
        const from = spec.sizes?.[0]?.monthlyCost ?? spec.monthlyCost;
        return (
          <button
            key={kind}
            className="palette-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, kind);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => addService(kind, { x: 260 + (nodeCount % 4) * 40, y: 60 + (nodeCount % 6) * 70 })}
            title={spec.description}
          >
            <span className="palette-icon" style={{ background: CATEGORY_COLOR[spec.category] }}>
              {KIND_GLYPH[kind]}
            </span>
            <span className="palette-text">
              <strong>{spec.shortName}</strong>
              <span className="muted small">{from > 0 ? `from ${money(from)}/mo` : 'pay per request'}</span>
            </span>
          </button>
        );
      })}
      <div className="legend">
        <h4>Traffic</h4>
        <span>
          <i style={{ background: '#38bdf8' }} /> static
        </span>
        <span>
          <i style={{ background: '#4ade80' }} /> reads
        </span>
        <span>
          <i style={{ background: '#fb923c' }} /> writes
        </span>
        <span>
          <i style={{ background: '#ef4444' }} /> failing
        </span>
      </div>
    </aside>
  );
}

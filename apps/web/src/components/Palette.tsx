import type { ServiceKind } from '@cloud-architect/content';
import { catalogue, money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { DRAG_MIME } from '../lib/design';
import { Glyph } from './Glyph';

const ORDER: ServiceKind[] = ['cloudfront', 's3', 'alb', 'ec2', 'asg', 'elasticache', 'rds', 'rds_replica'];

export function Palette() {
  const level = useGame((s) => s.level);
  const addService = useGame((s) => s.addService);
  const nodeCount = useGame((s) => s.nodes.length);
  if (!level) return null;
  const kinds = ORDER.filter((k) => (level.palette as readonly ServiceKind[]).includes(k));

  return (
    <aside className="palette" aria-label="Components">
      <h2 className="panel-label">Components</h2>
      <ul>
        {kinds.map((kind) => {
          const spec = catalogue.get(kind);
          const from = spec.sizes?.[0]?.monthlyCost ?? spec.monthlyCost;
          return (
            <li key={kind}>
              <button
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, kind);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() =>
                  addService(kind, { x: 280 + (nodeCount % 3) * 40, y: 80 + (nodeCount % 5) * 90 })
                }
                title={`${spec.description} ${from > 0 ? `From ${money(from)}/month.` : 'Pay per request.'}`}
              >
                <Glyph kind={kind} />
                <span>{spec.shortName}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="palette-tip">Drag onto the canvas or click to add</p>
    </aside>
  );
}

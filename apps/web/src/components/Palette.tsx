import type { ServiceKind } from '@cloud-architect/content';
import { GROUPS, catalogue, money } from '../lib/catalogue';
import { DRAG_MIME } from '../lib/design';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';
import { IconInfo } from './icons';

export function Palette() {
  const level = useGame((s) => s.level);
  const addService = useGame((s) => s.addService);
  const nodeCount = useGame((s) => s.nodes.length);
  const openGuide = useGame((s) => s.openGuide);
  if (!level) return null;
  const allowed = new Set<ServiceKind>(level.palette);
  const groups = GROUPS.map((g) => ({ ...g, kinds: g.kinds.filter((k) => allowed.has(k)) })).filter(
    (g) => g.kinds.length,
  );
  const showHeadings = groups.length > 1 && level.palette.length > 5;

  return (
    <aside className="palette" aria-label="Components">
      <h2 className="panel-label">Components</h2>
      {groups.map((g) => (
        <div key={g.label} className="palette-group">
          {showHeadings && <h3 className="palette-heading">{g.label}</h3>}
          <ul>
            {g.kinds.map((kind) => {
              const spec = catalogue.get(kind);
              const from = spec.sizes?.[0]?.monthlyCost ?? spec.monthlyCost;
              return (
                <li key={kind} className="palette-row">
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
                    title={`${spec.analogy} ${from > 0 ? `From ${money(from)}/month.` : 'Pay per request.'}`}
                  >
                    <Glyph kind={kind} />
                    <span>{spec.shortName}</span>
                  </button>
                  <button
                    className="palette-info"
                    onClick={() => openGuide(kind)}
                    aria-label={`What is ${spec.shortName}?`}
                    title={`What is ${spec.shortName}?`}
                  >
                    <IconInfo />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="palette-tip">Drag onto the canvas or click to add. ⓘ explains each one.</p>
    </aside>
  );
}

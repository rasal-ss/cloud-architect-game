import type { NodeConfig } from '@cloud-architect/content';
import { useMemo } from 'react';
import { CATEGORY_COLOR, KIND_GLYPH, catalogue, money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { BriefPanel } from './BriefPanel';
import { Sparkline } from './Sparkline';

const CDN_TTLS = [
  [60, '1 minute'],
  [3600, '1 hour'],
  [86400, '1 day'],
] as const;
const CACHE_TTLS = [
  [30, '30 seconds'],
  [300, '5 minutes'],
  [3600, '1 hour'],
] as const;

export function Inspector() {
  const selectedId = useGame((s) => s.selectedId);
  const node = useGame((s) => s.nodes.find((n) => n.id === s.selectedId));
  const update = useGame((s) => s.updateNode);
  const remove = useGame((s) => s.removeNode);
  const snapshots = useGame((s) => s.snapshots);
  const cursor = useGame((s) => s.cursor);
  const series = useMemo(
    () => (selectedId ? snapshots.map((s) => s.nodes[selectedId]?.util ?? 0) : []),
    [snapshots, selectedId],
  );

  if (!node) return <BriefPanel />;

  const spec = catalogue.get(node.data.kind);
  const c = { ...node.data.config };
  const set = (patch: NodeConfig) => update(node.id, { config: patch });
  const tick = snapshots[Math.floor(cursor)]?.nodes[node.id];

  return (
    <aside className="inspector" aria-label="Component inspector">
      <header className="insp-head">
        <span className="palette-icon" style={{ background: CATEGORY_COLOR[spec.category] }}>
          {KIND_GLYPH[spec.kind]}
        </span>
        <div>
          <h3>{spec.name}</h3>
          <span className="muted small">{spec.category}</span>
        </div>
      </header>
      <p>{spec.description}</p>

      {node.data.kind !== 'users' && (
        <label className="field">
          <span>Name</span>
          <input
            value={node.data.label ?? ''}
            placeholder={spec.shortName}
            maxLength={40}
            onChange={(e) => update(node.id, { label: e.target.value })}
          />
        </label>
      )}

      {spec.sizes && (
        <label className="field">
          <span>Instance size</span>
          <select value={c.size ?? spec.defaultSize} onChange={(e) => set({ size: e.target.value })}>
            {spec.sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}: {s.capacity} units/s, {money(s.monthlyCost)}/mo
              </option>
            ))}
          </select>
        </label>
      )}

      {(node.data.kind === 'ec2' || node.data.kind === 'rds' || node.data.kind === 'rds_replica') && (
        <label className="field">
          <span>Availability Zone</span>
          <select value={c.az} onChange={(e) => set({ az: e.target.value as 'a' | 'b' })}>
            <option value="a">AZ A</option>
            <option value="b">AZ B</option>
          </select>
        </label>
      )}

      {node.data.kind === 'asg' && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Min</span>
              <input
                type="number"
                min={1}
                max={50}
                value={c.min}
                onChange={(e) => set({ min: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label className="field">
              <span>Max</span>
              <input
                type="number"
                min={1}
                max={50}
                value={c.max}
                onChange={(e) => set({ max: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          </div>
          <label className="field">
            <span>Target CPU utilisation: {Math.round((c.targetUtilization ?? 0.6) * 100)}%</span>
            <input
              type="range"
              min={0.3}
              max={0.9}
              step={0.05}
              value={c.targetUtilization}
              onChange={(e) => set({ targetUtilization: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Spread over</span>
            <select value={c.azs} onChange={(e) => set({ azs: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1 Availability Zone</option>
              <option value={2}>2 Availability Zones</option>
            </select>
          </label>
        </>
      )}

      {(node.data.kind === 'ec2' || node.data.kind === 'asg') && (
        <>
          <label className="field">
            <span>Security group</span>
            <select
              value={c.securityGroup}
              onChange={(e) => set({ securityGroup: e.target.value as 'web-only' | 'open-all' })}
            >
              <option value="web-only">HTTP/HTTPS only (80, 443)</option>
              <option value="open-all">All ports incl. SSH from 0.0.0.0/0</option>
            </select>
          </label>
          {node.data.kind === 'ec2' && (
            <Toggle
              label="Elastic IP (fixed public address, $3.60/mo)"
              checked={!!c.elasticIp}
              onChange={(v) => set({ elasticIp: v })}
            />
          )}
          <Toggle
            label="CloudWatch alarms with auto-recovery ($1/mo)"
            checked={!!c.alarms}
            onChange={(v) => set({ alarms: v })}
          />
        </>
      )}

      {node.data.kind === 'alb' && (
        <Toggle
          label="Target health checks"
          checked={!!c.healthChecks}
          onChange={(v) => set({ healthChecks: v })}
        />
      )}

      {(node.data.kind === 'cloudfront' || node.data.kind === 'elasticache') && (
        <label className="field">
          <span>Cache TTL</span>
          <select value={c.ttlSeconds} onChange={(e) => set({ ttlSeconds: Number(e.target.value) })}>
            {(node.data.kind === 'cloudfront' ? CDN_TTLS : CACHE_TTLS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.data.kind === 'rds' && (
        <>
          <label className="field">
            <span>Automated backups</span>
            <select
              value={c.backupRetentionDays}
              onChange={(e) => set({ backupRetentionDays: Number(e.target.value) as 0 | 7 | 35 })}
            >
              <option value={0}>Off</option>
              <option value={7}>7 days ($3/mo)</option>
              <option value={35}>35 days ($10/mo)</option>
            </select>
          </label>
          <Toggle
            label="Publicly accessible"
            checked={!!c.publiclyAccessible}
            onChange={(v) => set({ publiclyAccessible: v })}
          />
        </>
      )}

      {tick && node.data.kind !== 'users' && (
        <section className="insp-live">
          <h4>Live metrics</h4>
          <div className="kv">
            <span>Load</span>
            <strong className={`status-text-${tick.status}`}>
              {tick.status === 'down' ? 'DOWN' : `${Math.round(tick.util * 100)}%`}
            </strong>
            <span>Requests</span>
            <strong>{tick.rps.toFixed(1)}/s</strong>
            {tick.instances !== undefined && (
              <>
                <span>Instances</span>
                <strong>
                  {tick.instances} in service{tick.pending ? `, ${tick.pending} booting` : ''}
                </strong>
              </>
            )}
          </div>
          <Sparkline values={series} cursor={cursor} label={`${spec.shortName} load over the day`} />
        </section>
      )}

      <details className="service-card">
        <summary>Service card</summary>
        <p>
          <strong>Use it for:</strong> {spec.whenToUse}
        </p>
        <p>
          <strong>Avoid it for:</strong> {spec.whenNotToUse}
        </p>
        {spec.docsUrl && (
          <a href={spec.docsUrl} target="_blank" rel="noreferrer">
            AWS documentation ↗
          </a>
        )}
      </details>

      {!node.data.locked && (
        <button className="btn danger" onClick={() => remove(node.id)}>
          Delete component
        </button>
      )}
    </aside>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

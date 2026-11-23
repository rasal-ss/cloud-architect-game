import type { NodeConfig } from '@cloud-architect/content';
import { useMemo } from 'react';
import { catalogue, money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { BriefPanel } from './BriefPanel';
import { IconClose } from './icons';
import { Glyph } from './Glyph';
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

/** Right-hand panel: the brief by default, or the settings of the selected component. */
export function Inspector() {
  const node = useGame((s) => s.nodes.find((n) => n.id === s.selectedId));
  return <aside className="side">{node ? <NodeSettings id={node.id} /> : <BriefPanel />}</aside>;
}

function NodeSettings({ id }: { id: string }) {
  const node = useGame((s) => s.nodes.find((n) => n.id === id))!;
  const update = useGame((s) => s.updateNode);
  const remove = useGame((s) => s.removeNode);
  const select = useGame((s) => s.select);
  const openGuide = useGame((s) => s.openGuide);
  const snapshots = useGame((s) => s.snapshots);
  const cursor = useGame((s) => s.cursor);
  const series = useMemo(() => snapshots.map((s) => s.nodes[id]?.util ?? 0), [snapshots, id]);

  const spec = catalogue.get(node.data.kind);
  const kind = node.data.kind;
  const c = node.data.config;
  const set = (patch: NodeConfig) => update(id, { config: patch });
  const tick = snapshots[Math.floor(cursor)]?.nodes[id];
  const size = spec.sizes?.find((s) => s.id === (c.size ?? spec.defaultSize));

  return (
    <div className="panel-body">
      <header className="node-head">
        <Glyph kind={kind} size="lg" />
        <div>
          <h2>{node.data.label ?? spec.shortName}</h2>
          <p>{spec.name}</p>
        </div>
        <button
          className="icon-btn"
          onClick={() => select(null)}
          aria-label="Close settings"
          title="Back to the brief"
        >
          <IconClose />
        </button>
      </header>
      <p className="node-desc">{spec.analogy}</p>

      {tick && kind !== 'users' && (
        <section className="panel-section live">
          <div className="live-head">
            <h3 className="panel-label">Load today</h3>
            <span className={`live-value status-text-${tick.status}`}>
              {tick.status === 'down' ? 'Down' : `${Math.round(tick.util * 100)}%`}
              {tick.instances !== undefined && `, ${tick.instances} running`}
            </span>
          </div>
          <Sparkline values={series} cursor={cursor} label={`${spec.shortName} load over the day`} />
        </section>
      )}

      {kind !== 'users' && kind !== 'payment' && (
        <section className="panel-section">
          <h3 className="panel-label">Settings</h3>

          {spec.sizes && (
            <label className="field">
              <span>Size</span>
              <select value={c.size ?? spec.defaultSize} onChange={(e) => set({ size: e.target.value })}>
                {spec.sizes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                    {s.monthlyCost > 0 ? `, ${money(s.monthlyCost)}/mo` : ''}
                  </option>
                ))}
              </select>
              {size && (
                <small>
                  Handles about {size.capacity.toLocaleString()} units of work per second
                  {kind === 'asg' ? ' per instance' : kind === 'lambda' ? ' per running execution' : ''}.
                  {kind === 'lambda' && ' More memory also means more CPU and shorter cold starts.'}
                </small>
              )}
            </label>
          )}

          {kind === 'asg' && (
            <>
              <div className="field-pair">
                <label className="field">
                  <span>Min instances</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={c.min}
                    onChange={(e) => set({ min: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </label>
                <label className="field">
                  <span>Max instances</span>
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
                <span>
                  Scale out above <b>{Math.round((c.targetUtilization ?? 0.6) * 100)}% CPU</b>
                </span>
                <input
                  type="range"
                  min={0.3}
                  max={0.9}
                  step={0.05}
                  value={c.targetUtilization}
                  onChange={(e) => set({ targetUtilization: Number(e.target.value) })}
                />
              </label>
              <Segment
                label="Availability Zones"
                value={c.azs}
                options={[
                  [1, 'One'],
                  [2, 'Two'],
                ]}
                onChange={(v) => set({ azs: v as 1 | 2 })}
              />
            </>
          )}

          {(kind === 'ec2' || kind === 'rds' || kind === 'rds_replica') && (
            <Segment
              label="Availability Zone"
              value={c.az}
              options={[
                ['a', 'A'],
                ['b', 'B'],
              ]}
              onChange={(v) => set({ az: v as 'a' | 'b' })}
            />
          )}

          {(kind === 'ec2' || kind === 'asg') && (
            <>
              <Segment
                label="Firewall (security group)"
                value={c.securityGroup}
                options={[
                  ['web-only', 'Web only'],
                  ['open-all', 'Everything open'],
                ]}
                onChange={(v) => set({ securityGroup: v as 'web-only' | 'open-all' })}
              />
              {kind === 'ec2' && (
                <Toggle
                  label="Elastic IP"
                  hint="A fixed public address, $3.60/mo"
                  checked={!!c.elasticIp}
                  onChange={(v) => set({ elasticIp: v })}
                />
              )}
              <Toggle
                label="CloudWatch alarms"
                hint="Detect failures and recover faster, $1/mo"
                checked={!!c.alarms}
                onChange={(v) => set({ alarms: v })}
              />
              <Segment
                label="Where logged-in sessions live"
                value={c.sessionStore}
                options={[
                  ['instance', 'On the server'],
                  ['cache', 'In ElastiCache'],
                ]}
                onChange={(v) => set({ sessionStore: v as 'instance' | 'cache' })}
              />
            </>
          )}

          {kind === 'lambda' && (
            <label className="field">
              <span>
                Most executions at once <b>{c.concurrency}</b>
              </span>
              <input
                type="number"
                min={1}
                max={10000}
                value={c.concurrency}
                onChange={(e) => set({ concurrency: Math.max(1, Number(e.target.value) || 1) })}
              />
              <small>
                Requests above this are throttled. Each running execution opens its own database connection.
              </small>
            </label>
          )}

          {kind === 'dynamodb' && (
            <>
              <Segment
                label="Capacity"
                value={c.capacityMode}
                options={[
                  ['on-demand', 'Pay per request'],
                  ['provisioned', 'Fixed capacity'],
                ]}
                onChange={(v) => set({ capacityMode: v as 'on-demand' | 'provisioned' })}
              />
              {c.capacityMode === 'provisioned' && (
                <label className="field">
                  <span>Units of work per second</span>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={c.provisionedUnits}
                    onChange={(e) => set({ provisionedUnits: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <small>About $0.35 per unit per month. Anything above it is throttled.</small>
                </label>
              )}
              <label className="field">
                <span>Partition key</span>
                <select
                  value={c.partitionKey}
                  onChange={(e) => set({ partitionKey: e.target.value as typeof c.partitionKey })}
                >
                  <option value="order-id">Order ID (every value different)</option>
                  <option value="customer-id">Customer ID</option>
                  <option value="coupon-code">Coupon code</option>
                  <option value="coupon-code-sharded">Coupon code plus a shard suffix</option>
                </select>
                <small>Requests that share a key land on the same partition, which has a limit.</small>
              </label>
            </>
          )}

          {kind === 'sqs' && (
            <>
              <Toggle
                label="Dead-letter queue"
                hint="Set aside messages that fail three times"
                checked={!!c.dlq}
                onChange={(v) => set({ dlq: v })}
              />
              <Toggle
                label="FIFO ordering"
                hint="Strict order, but at most 300 messages a second"
                checked={!!c.fifo}
                onChange={(v) => set({ fifo: v })}
              />
            </>
          )}

          {kind === 'alb' && (
            <Toggle
              label="Health checks"
              hint="Stop sending traffic to dead servers"
              checked={!!c.healthChecks}
              onChange={(v) => set({ healthChecks: v })}
            />
          )}

          {(kind === 'cloudfront' || kind === 'elasticache') && (
            <label className="field">
              <span>Keep cached copies for</span>
              <select value={c.ttlSeconds} onChange={(e) => set({ ttlSeconds: Number(e.target.value) })}>
                {(kind === 'cloudfront' ? CDN_TTLS : CACHE_TTLS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <small>Longer means more hits, but staler data.</small>
            </label>
          )}

          {kind === 'rds' && (
            <>
              <Segment
                label="Automated backups"
                value={c.backupRetentionDays}
                options={[
                  [0, 'Off'],
                  [7, '7 days'],
                  [35, '35 days'],
                ]}
                onChange={(v) => set({ backupRetentionDays: v as 0 | 7 | 35 })}
              />
              <Toggle
                label="Multi-AZ standby"
                hint="A copy in another zone takes over in a minute. Doubles the price"
                checked={!!c.multiAz}
                onChange={(v) => set({ multiAz: v })}
              />
              <Toggle
                label="Publicly accessible"
                hint="Anyone on the internet can try to connect"
                checked={!!c.publiclyAccessible}
                onChange={(v) => set({ publiclyAccessible: v })}
              />
            </>
          )}

          <label className="field">
            <span>Name</span>
            <input
              value={node.data.label ?? ''}
              placeholder={spec.shortName}
              maxLength={40}
              onChange={(e) => update(id, { label: e.target.value })}
            />
          </label>
        </section>
      )}

      <details className="panel-section disclosure">
        <summary>How {spec.shortName} works</summary>
        <p>{spec.inGame}</p>
        <p>
          <b>Good for:</b> {spec.whenToUse}
        </p>
        <p>
          <b>Avoid for:</b> {spec.whenNotToUse}
        </p>
        <button className="link-btn" onClick={() => openGuide(kind)}>
          Open in the service guide
        </button>
      </details>

      {!node.data.locked && (
        <button className="link-btn danger" onClick={() => remove(id)}>
          Remove from design
        </button>
      )}
    </div>
  );
}

function Segment<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span id={`seg-${label}`}>{label}</span>
      <div className="segmented full" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={value === v}
            className={value === v ? 'on' : ''}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  );
}

interface Props {
  values: number[];
  cursor: number;
  max?: number;
  height?: number;
  label: string;
}

/** A tiny inline chart of a node's load over the simulated day, with a red line at 100%. */
export function Sparkline({ values, cursor, max = 1.5, height = 56, label }: Props) {
  const width = 240;
  if (!values.length) return null;
  const step = width / Math.max(1, values.length - 1);
  const y = (v: number) => height - (Math.min(v, max) / max) * height;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={0} x2={width} y1={y(1)} y2={y(1)} className="spark-limit" />
      <line x1={0} x2={width} y1={y(0.8)} y2={y(0.8)} className="spark-warn" />
      <path d={d} className="spark-line" />
      <line x1={cursor * step} x2={cursor * step} y1={0} y2={height} className="spark-cursor" />
    </svg>
  );
}

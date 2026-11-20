import { type Level, type NodeConfig, type ServiceKind, getLevel, levels } from '@cloud-architect/content';
import { type SimResult, type TickSnapshot, defaultConfig } from '@cloud-architect/engine';
import {
  type Connection,
  type EdgeChange,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';
import { create } from 'zustand';
import { catalogue } from '../lib/catalogue';
import { type ServiceFlowNode, type TrafficFlowEdge, fromFlow, nextId, toFlow } from '../lib/design';
import { type SandboxSettings, DEFAULT_SANDBOX, SANDBOX_ID, sandboxLevel } from '../lib/sandbox';
import { type LevelProgress, loadDesign, loadProgress, recordResult, saveDesign } from '../lib/storage';
import { runSimulation } from '../sim/client';

export type Speed = 1 | 4 | 16;
/** Simulated minutes per real second at 1x: one day in 60 seconds. */
export const MINUTES_PER_SECOND = 24;

export type SimStatus = 'idle' | 'computing' | 'playing' | 'paused' | 'finished';

interface GameState {
  screen: 'menu' | 'level';
  level: Level | null;
  sandbox: SandboxSettings;
  nodes: ServiceFlowNode[];
  edges: TrafficFlowEdge[];
  selectedId: string | null;
  progress: Record<string, LevelProgress>;
  toast: string | null;

  status: SimStatus;
  speed: Speed;
  snapshots: TickSnapshot[];
  result: SimResult | null;
  /** Fractional playback position in simulated minutes. */
  cursor: number;
  showReport: boolean;

  openLevel: (id: string) => void;
  openSandbox: () => void;
  backToMenu: () => void;
  updateSandbox: (s: Partial<SandboxSettings>) => void;

  onNodesChange: (changes: NodeChange<ServiceFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<TrafficFlowEdge>[]) => void;
  connect: (c: Connection) => void;
  addService: (kind: ServiceKind, position: { x: number; y: number }) => void;
  updateNode: (id: string, patch: { config?: NodeConfig; label?: string }) => void;
  removeNode: (id: string) => void;
  select: (id: string | null) => void;
  resetDesign: () => void;
  notify: (msg: string | null) => void;

  run: () => Promise<void>;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (minute: number) => void;
  advance: (seconds: number) => void;
  setShowReport: (v: boolean) => void;
}

const invalidated = { status: 'idle' as const, snapshots: [], result: null, cursor: 0, showReport: false };

export function isValidConnection(nodes: ServiceFlowNode[], c: { source: string; target: string }): boolean {
  const from = nodes.find((n) => n.id === c.source);
  const to = nodes.find((n) => n.id === c.target);
  return !!from && !!to && from.id !== to.id && catalogue.canConnect(from.data.kind, to.data.kind);
}

export const useGame = create<GameState>()((set, get) => {
  /** Persist the current design for the open level. */
  const persist = () => {
    const { level, nodes, edges } = get();
    if (level) saveDesign(level.id, fromFlow(nodes, edges));
  };

  const load = (level: Level) => {
    const saved = loadDesign(level.id);
    const { nodes, edges } = toFlow(saved ?? level.startingDesign);
    set({ screen: 'level', level, nodes, edges, selectedId: null, ...invalidated });
  };

  return {
    screen: 'menu',
    level: null,
    sandbox: DEFAULT_SANDBOX,
    nodes: [],
    edges: [],
    selectedId: null,
    progress: loadProgress(),
    toast: null,
    status: 'idle',
    speed: 4,
    snapshots: [],
    result: null,
    cursor: 0,
    showReport: false,

    openLevel: (id) => {
      const level = getLevel(id);
      if (level) load(level);
    },
    openSandbox: () => load(sandboxLevel(get().sandbox)),
    backToMenu: () => set({ screen: 'menu', level: null, ...invalidated }),
    updateSandbox: (s) => {
      const sandbox = { ...get().sandbox, ...s };
      set({ sandbox, level: sandboxLevel(sandbox), ...invalidated });
    },

    onNodesChange: (changes) => {
      const { nodes } = get();
      const safe = changes.filter(
        (c) => c.type !== 'remove' || !nodes.find((n) => n.id === c.id)?.data.locked,
      );
      const structural = safe.some((c) => c.type === 'remove' || c.type === 'add');
      const removed = new Set(safe.filter((c) => c.type === 'remove').map((c) => c.id));
      set((s) => ({
        nodes: applyNodeChanges(safe, s.nodes),
        edges: removed.size
          ? s.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target))
          : s.edges,
        selectedId: s.selectedId && removed.has(s.selectedId) ? null : s.selectedId,
        ...(structural ? invalidated : {}),
      }));
      if (safe.some((c) => c.type !== 'select' && c.type !== 'dimensions')) persist();
    },
    onEdgesChange: (changes) => {
      set((s) => ({
        edges: applyEdgeChanges(changes, s.edges),
        ...(changes.some((c) => c.type === 'remove') ? invalidated : {}),
      }));
      persist();
    },
    connect: (c) => {
      const { nodes, edges } = get();
      if (!c.source || !c.target) return;
      if (!isValidConnection(nodes, c)) {
        const from = nodes.find((n) => n.id === c.source);
        const to = nodes.find((n) => n.id === c.target);
        if (from && to) {
          get().notify(
            `${catalogue.get(from.data.kind).shortName} cannot send requests to ${catalogue.get(to.data.kind).shortName}.`,
          );
        }
        return;
      }
      const id = `${c.source}-${c.target}`;
      if (edges.some((e) => e.id === id)) return;
      set({ edges: [...edges, { id, source: c.source, target: c.target, type: 'traffic' }], ...invalidated });
      persist();
    },
    addService: (kind, position) => {
      const { nodes, level } = get();
      if (level && kind !== 'users' && !level.palette.includes(kind)) return;
      const id = nextId(
        kind,
        nodes.map((n) => n.id),
      );
      const node: ServiceFlowNode = {
        id,
        type: 'service',
        position,
        data: { kind, config: defaultConfig(kind, catalogue.get(kind)) },
      };
      set({ nodes: [...nodes, node], selectedId: id, ...invalidated });
      persist();
    },
    updateNode: (id, patch) => {
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...(patch.label !== undefined ? { label: patch.label || undefined } : {}),
                  config: { ...n.data.config, ...patch.config },
                },
              }
            : n,
        ),
        ...(patch.config ? invalidated : {}),
      }));
      persist();
    },
    removeNode: (id) => get().onNodesChange([{ type: 'remove', id }]),
    select: (id) => set({ selectedId: id }),
    resetDesign: () => {
      const { level } = get();
      if (!level) return;
      saveDesign(level.id, null);
      const { nodes, edges } = toFlow(level.startingDesign);
      set({ nodes, edges, selectedId: null, ...invalidated });
    },
    notify: (toast) => set({ toast }),

    run: async () => {
      const { level, nodes, edges } = get();
      if (!level) return;
      set({ status: 'computing', showReport: false, selectedId: null });
      try {
        const { snapshots, result } = await runSimulation(fromFlow(nodes, edges), level);
        if (get().status !== 'computing') return; // the design changed while computing
        if (!result.valid) {
          set({ ...invalidated, result, showReport: true });
          return;
        }
        set({ snapshots, result, cursor: 0, status: 'playing' });
        if (level.id !== SANDBOX_ID) {
          set({
            progress: recordResult(level.id, {
              stars: result.stars,
              score: result.score,
              cost: result.metrics.monthlyCost,
            }),
          });
        }
      } catch (err) {
        set({ ...invalidated, toast: `Simulation failed: ${(err as Error).message}` });
      }
    },
    togglePlay: () => {
      const { status, cursor, snapshots } = get();
      if (status === 'playing') set({ status: 'paused' });
      else if (status === 'paused') set({ status: 'playing' });
      else if (status === 'finished') {
        set({ status: 'playing', cursor: cursor >= snapshots.length - 1 ? 0 : cursor, showReport: false });
      }
    },
    setSpeed: (speed) => set({ speed }),
    seek: (minute) => {
      const { snapshots, status } = get();
      if (!snapshots.length) return;
      const cursor = Math.max(0, Math.min(snapshots.length - 1, minute));
      set({ cursor, status: status === 'finished' ? 'paused' : status });
    },
    advance: (seconds) => {
      const { status, cursor, speed, snapshots } = get();
      if (status !== 'playing') return;
      const next = cursor + seconds * MINUTES_PER_SECOND * speed;
      if (next >= snapshots.length - 1) {
        set({ cursor: snapshots.length - 1, status: 'finished', showReport: true });
      } else set({ cursor: next });
    },
    setShowReport: (showReport) => set({ showReport }),
  };
});

/** The snapshot under the playback cursor, if a run is loaded. */
export const useSnapshot = () =>
  useGame((s) => (s.snapshots.length ? s.snapshots[Math.floor(s.cursor)] : undefined));

export const nextLevelId = (id: string): string | undefined => {
  const i = levels.findIndex((l) => l.id === id);
  return i >= 0 ? levels[i + 1]?.id : undefined;
};

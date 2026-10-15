import type { Commit } from '../types';
export interface GraphEdge { from: number; to: number; color: number }
export interface GraphRow { lane: number; color: number; edges: GraphEdge[]; width: number }
export function layoutGraph(commits: Commit[]): GraphRow[] {
  let lanes: { hash: string; color: number }[] = []; let nextColor = 0; const rows: GraphRow[] = [];
  for (const commit of commits) {
    let lane = lanes.findIndex(l => l.hash === commit.hash);
    if (lane < 0) { lane = lanes.length; lanes.push({ hash: commit.hash, color: nextColor++ % 8 }); }
    const before = lanes.map(l => ({ ...l })); const color = lanes[lane].color;
    lanes.splice(lane, 1);
    commit.parents.forEach((parent, i) => {
      if (!lanes.some(l => l.hash === parent)) lanes.splice(Math.min(lane + i, lanes.length), 0, { hash: parent, color: i === 0 ? color : nextColor++ % 8 });
    });
    const edges: GraphEdge[] = [];
    before.forEach((entry, from) => {
      if (from === lane) commit.parents.forEach(parent => { const to = lanes.findIndex(l => l.hash === parent); if (to >= 0) edges.push({ from, to, color: lanes[to].color }); });
      else { const to = lanes.findIndex(l => l.hash === entry.hash); if (to >= 0) edges.push({ from, to, color: entry.color }); }
    });
    rows.push({ lane, color, edges, width: Math.max(before.length, lanes.length, 1) });
  }
  return rows;
}

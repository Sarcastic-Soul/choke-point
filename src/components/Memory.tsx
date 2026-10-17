"use client";

import { ArrowClockwise, PlusCircle, Trash } from "@phosphor-icons/react";
import type { FixRecord } from "@/lib/graph/fixes";

interface Props {
  fixes: FixRecord[];
  busy: boolean;
  onDrift: () => void;
  onRescan: () => void;
  onReset: () => void;
  /** The grant-a-permission demo only fits the Northwind data. */
  demo?: boolean;
}

export function Memory({ fixes, busy, onDrift, onRescan, onReset, demo = true }: Props) {
  return (
    <section className="memory" aria-label="Memory">
      <h2>Memory</h2>
      {fixes.length === 0 ? (
        <p className="muted">No approved fixes yet. Approved fixes are stored in the graph, so the next scan can check them.</p>
      ) : (
        fixes.map((f) => (
          <div key={f.id} className="fix">
            <span>{f.title}</span>
            <span>{f.pathsBefore} to {f.pathsAfter}</span>
          </div>
        ))
      )}
      <div className="row">
        {demo && <button className="btn" disabled={busy || fixes.length === 0} onClick={onDrift}><PlusCircle size={16} weight="bold" />Grant a new permission</button>}
        <button className="btn" disabled={busy || fixes.length === 0} onClick={onRescan}><ArrowClockwise size={16} weight="bold" />Re-scan</button>
        <button className="btn" disabled={busy} onClick={onReset}><Trash size={16} weight="bold" />Reset demo</button>
      </div>
    </section>
  );
}

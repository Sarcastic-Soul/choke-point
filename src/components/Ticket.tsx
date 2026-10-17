"use client";

import { Check, Scissors } from "@phosphor-icons/react";
import type { FixDraft } from "@/lib/graph/fixes";

interface Props {
  draft: FixDraft | null;
  cut: boolean;
  busy: boolean;
  approved: boolean;
  onApprove: () => void;
}

export function Ticket({ draft, cut, busy, approved, onApprove }: Props) {
  if (!draft) return null;
  return (
    <section className="ticket" aria-label="Draft fix ticket">
      <h2>Draft fix ticket</h2>
      <h3>{draft.title}</h3>
      <p>{draft.body}</p>
      <pre>{draft.command}</pre>
      <p className="muted">This is a draft. Nothing changes until a person approves it.</p>
      {!cut && !approved && <p className="muted">Preview the cut first. Approve unlocks once you have seen the effect.</p>}
      <div className="row">
        <button className="btn hot" disabled={!cut || busy || approved} onClick={onApprove}>
          {approved ? <Check size={16} weight="bold" /> : <Scissors size={16} weight="bold" />}
          {approved ? "Approved and remembered" : "Approve this fix"}
        </button>
      </div>
    </section>
  );
}

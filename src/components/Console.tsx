"use client";

import { CircleNotch, PaperPlaneRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export type Line =
  | { kind: "you"; text: string }
  | { kind: "tool"; name: string; input: string; rows?: string }
  | { kind: "note"; text: string }
  | { kind: "bot"; text: string; mode: "model" | "offline"; checked: boolean; problems: string[] };

interface Props {
  lines: Line[];
  busy: boolean;
  identity: string | null;
  onAsk: (text: string) => void;
}

function renderBot(text: string) {
  return text.split(/(`[^`]+`)/g).map((p, i) => (p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p));
}

export function Console({ lines, busy, identity, onAsk }: Props) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [lines]);

  const chips = identity
    ? [`Which secrets can ${identity} reach?`, "Which machines carry the most load in the company?", `Does the last fix for ${identity} still hold?`]
    : ["alice.moreno is compromised. What do we fix first?", "Which machines carry the most load in the company?"];

  return (
    <section aria-label="Ask the agent" className="thread" role="log" aria-live="polite">
      <h2>Ask the agent</h2>
      {lines.length === 0 && <p className="muted">Name an identity that may be compromised. The agent runs fixed graph queries and explains what it finds. It never writes its own queries.</p>}
      {lines.map((l, i) =>
        l.kind === "you" ? (
          <p key={i} className="msg you">{l.text}</p>
        ) : l.kind === "note" ? (
          <p key={i} className="msg note" role="alert">{l.text}</p>
        ) : l.kind === "tool" ? (
          <div key={i} className="tool"><b>{l.name}</b> {l.input}{l.rows ? <><br />{l.rows}</> : null}</div>
        ) : (
          <div key={i} className="msg bot">
            <p style={{ margin: 0 }}>{renderBot(l.text)}</p>
            <p className={`verdict${l.checked ? "" : " warn"}`} style={{ margin: "6px 0 0" }}>
              {l.mode === "offline" ? "Answered from the graph, no model. " : ""}
              {l.checked ? "Names in backticks and all numbers were matched against the query rows." : "The model answer failed the check, so this text is built from the rows."}
              {l.problems?.length > 0 && !l.checked ? ` (${l.problems[0]})` : ""}
            </p>
          </div>
        ),
      )}
      {busy && <p role="status" className="muted"><CircleNotch className="spin" size={14} style={{ verticalAlign: -2 }} /> Querying the graph</p>}
      <div ref={end} />
      <form className="ask" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) { onAsk(text.trim()); setText(""); } }}>
        <input aria-label="Question" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about an identity" />
        <button className="btn" type="submit" disabled={busy || !text.trim()} aria-label="Send"><PaperPlaneRight size={16} weight="bold" /></button>
      </form>
      <div className="chips">
        {chips.map((c) => <button key={c} className="chip" disabled={busy} onClick={() => onAsk(c)}>{c}</button>)}
      </div>
    </section>
  );
}

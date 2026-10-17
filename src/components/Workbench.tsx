"use client";

import { MagnifyingGlass, Scissors } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/run";
import type { FixDraft, FixRecord } from "@/lib/graph/fixes";
import { analyze, type PathGraph } from "@/lib/view";
import { Console, type Line } from "./Console";
import { Counter } from "./Counter";
import { GraphView } from "./GraphView";
import { Memory } from "./Memory";
import { Ticket } from "./Ticket";

interface Choke { id: string; type: string; from: string; to: string; note: string; paths: number; percent: number }
type Loaded = PathGraph & { choke: Choke[]; fixes: FixRecord[] };

const DEMO = "alice.moreno";

// Never throws: a failed call comes back as { ok: false } with a message the page can show.
async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: { error: "The server could not be reached." } };
  }
}
const post = (url: string, body?: unknown) =>
  call(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export function Workbench() {
  const [name, setName] = useState(DEMO);
  const [data, setData] = useState<Loaded | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [cut, setCut] = useState(false);
  const [draft, setDraft] = useState<FixDraft | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; suggestions: string[] } | null>(null);
  const loadSeq = useRef(0);
  const pickSeq = useRef(0);

  const load = useCallback(async (who: string, keepFocus = false) => {
    const seq = ++loadSeq.current;
    const { ok, body } = await call(`/api/graph?from=${encodeURIComponent(who)}`);
    if (seq !== loadSeq.current) return null; // a newer request owns the screen
    if (!ok || body.status !== "ok") {
      setData(null);
      setDraft(null);
      setFocus(null);
      setCut(false);
      if (body.status === "unknown_entity") setProblem({ text: `"${who}" is not in the graph.`, suggestions: (body.suggestions as string[]) ?? [] });
      else setNotice("Could not read the graph. Check that the database is running.");
      return null;
    }
    setProblem(null);
    setNotice(null);
    const loaded = body as unknown as Loaded;
    setData(loaded);
    if (!keepFocus) {
      setFocus(loaded.choke[0]?.id ?? null);
      setCut(false);
    }
    return loaded;
  }, []);

  const pick = useCallback(async (who: string, edgeId: string | null) => {
    const seq = ++pickSeq.current;
    setFocus(edgeId);
    setCut(false);
    setDraft(null);
    if (!edgeId) return;
    const { ok, body } = await call(`/api/whatif?from=${encodeURIComponent(who)}&edge=${encodeURIComponent(edgeId)}`);
    if (seq !== pickSeq.current) return;
    if (ok) setDraft(body.draft as FixDraft);
    else setNotice("Could not draft the fix ticket for that link. Pick it again.");
  }, []);

  const askingRef = useRef(false);
  const ask = useCallback(async (message: string) => {
    if (askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    setLines((l) => [...l, { kind: "you", text: message.length > 120 ? `${message.slice(0, 120)}…` : message }]);
    const say = (text: string) => setLines((l) => [...l, { kind: "note", text }]);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      if (!res.ok || !res.body) {
        say(
          res.status === 403 ? "That request was refused."
            : res.status === 400 ? "That question is empty or longer than 500 characters."
            : "The agent could not be reached. Check that the server and the database are running.",
        );
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const p of parts.filter(Boolean)) {
            const ev = JSON.parse(p) as AgentEvent;
            if (ev.type === "tool") setLines((l) => [...l, { kind: "tool", name: ev.name, input: JSON.stringify(ev.input) }]);
            else if (ev.type === "result") {
              const out = ev.output as { status?: string; total?: number };
              const rows = out.status === "ok" && typeof out.total === "number" ? `${out.total} paths` : out.status;
              setLines((l) => {
                const at = l.findLastIndex((x) => x.kind === "tool" && x.name === ev.name && !x.rows);
                return at < 0 ? l : l.map((x, i) => (i === at && x.kind === "tool" ? { ...x, rows } : x));
              });
            } else if (ev.type === "final") setLines((l) => [...l, { kind: "bot", text: ev.text, mode: ev.mode, checked: ev.checked, problems: ev.problems }]);
            else if (ev.type === "error") say(ev.text);
          }
        }
      }
    } catch {
      say("The agent stopped before it finished. Try again.");
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }, []);

  const scan = useCallback(async (who: string) => {
    setBusy(true);
    setNotice(null);
    setDraft(null);
    const g = await load(who);
    if (g) await pick(g.from, g.choke[0]?.id ?? null);
    setBusy(false);
    void ask(`${g?.from ?? who} is compromised. What do we fix first?`.slice(0, 500));
  }, [load, pick, ask]);

  const stats = useMemo(() => {
    if (!data) return null;
    const c = data.choke.find((x) => x.id === focus);
    const e = data.edges.find((x) => x.id === focus);
    const edge = c ? { ...c } : e ? { id: e.id, type: e.type, from: e.source, to: e.target, note: e.note, paths: e.paths } : undefined;
    const left = focus ? analyze(data, focus).total : null;
    return { edge, left };
  }, [data, focus]);

  const lastFix = data?.fixes[0];
  const approved = Boolean(data?.fixes.some((f) => f.edgeId === focus));
  const freshSince = lastFix ? lastFix.at : null;
  const fixed = !cut && Boolean(lastFix);

  const approve = async () => {
    if (!data || !focus || draft?.edgeId !== focus) return;
    setBusy(true);
    const r = await post("/api/fix", { from: data.from, edgeId: focus });
    if (!r.ok) setNotice(typeof r.body.error === "string" ? r.body.error : "The fix could not be saved.");
    await load(data.from, true);
    setCut(false);
    setBusy(false);
  };
  const drift = async () => {
    if (!data) return;
    setBusy(true);
    const r = await post("/api/drift");
    if (!r.ok) setNotice(typeof r.body.error === "string" ? r.body.error : "Could not add the permission.");
    await load(data.from, true);
    setBusy(false);
  };
  const rescan = async () => {
    if (!data) return;
    await load(data.from, true);
    void ask(`Does the last fix for ${data.from} still hold? Anything changed?`);
  };
  const reset = async () => {
    setBusy(true);
    const r = await post("/api/reset");
    if (!r.ok) setNotice(typeof r.body.error === "string" ? r.body.error : "Reset failed.");
    else {
      loadSeq.current++;
      setData(null);
      setLines([]);
      setDraft(null);
      setFocus(null);
      setCut(false);
      setProblem(null);
    }
    setBusy(false);
  };

  const caption = data
    ? cut
      ? `paths left if this one link is cut, out of ${data.total} today`
      : fixed
        ? `paths left from ${data.from} since the last approved fix`
        : `ways ${data.from} can reach the domain controller and the key secrets`
    : "";

  return (
    <main className="shell">
      <header className="top">
        <h1>Choke Point</h1>
        <p>Northwind Freight · synthetic graph · FalkorDB</p>
      </header>

      <div className="cols">
        <div>
          <form className="scan" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !busy) void scan(name.trim()); }}>
            <label htmlFor="who">Compromised identity</label>
            <input id="who" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            <button className="btn" type="submit" disabled={busy || !name.trim()}><MagnifyingGlass size={16} weight="bold" />Trace paths</button>
            {problem && (
              <span className="note">
                {problem.text}{problem.suggestions.length > 0 && " Try: "}
                {problem.suggestions.map((s) => <button key={s} type="button" className="chip" disabled={busy} style={{ marginLeft: 8 }} onClick={() => { setName(s); void scan(s); }}>{s}</button>)}
              </span>
            )}
          </form>
          {notice && <p role="alert" className="alert">{notice}</p>}

          {data && data.total === 0 ? (
            <p className="empty">No attack path is modeled from {data.from}. That does not mean it is safe. It means this graph has no route from there to the crown jewels.</p>
          ) : data ? (
            <>
              <Counter before={fixed ? lastFix!.pathsBefore : data.total} after={cut ? stats?.left ?? null : fixed ? data.total : null} caption={caption} />
              <div className="stage" role="region" aria-label="Attack path graph" tabIndex={0}>
                <GraphView graph={data} cutEdge={cut ? focus : null} selected={focus} freshSince={freshSince} onSelect={(id) => void pick(data.from, id)} />
              </div>
              <p className="scroll-hint">Scroll the graph sideways to follow the route to the crown jewels.</p>
              <div className="legend">
                <span><i className="user" />user</span><span><i className="host" />host</span><span><i className="secret" />secret</span><span><i className="crown" />crown jewel</span>
                <span><i className="line" />attack route, thicker means more paths</span>
              </div>
              {data.choke.length > 1 && (
                <div className="ranked">
                  <span>Links by paths cut:</span>
                  {data.choke.map((c) => (
                    <button key={c.id} className="chip" aria-pressed={c.id === focus} onClick={() => void pick(data.from, c.id)}>
                      {c.from} → {c.to} ({c.percent}%)
                    </button>
                  ))}
                </div>
              )}
              {data.choke.length === 0 && (
                <p className="muted" style={{ marginTop: 14 }}>Every route starts at {data.from} itself, so there is no single link to cut here. Look at the rights this identity already holds.</p>
              )}
              {stats?.edge && (
                <div className="link">
                  <div>
                    <b>{stats.edge.from} → {stats.edge.to}</b>
                    <div className="meta mono">{stats.edge.type}{` · on ${stats.edge.paths} of ${data.total} paths`}</div>
                    {stats.edge.note && <div className="meta">{stats.edge.note}</div>}
                  </div>
                  <button className="btn" onClick={() => setCut((c) => !c)}><Scissors size={16} weight="bold" />{cut ? "Put it back" : "Preview the cut"}</button>
                </div>
              )}
            </>
          ) : (
            <p className="empty">{problem ? "Pick a name from the graph and trace again." : "Pick who was compromised. The graph will show every route to the crown jewels, and the one link worth cutting."}</p>
          )}
        </div>

        <aside className="side">
          <Console lines={lines} busy={asking} identity={data?.from ?? null} onAsk={(t) => void ask(t)} />
          <Ticket draft={draft?.edgeId === focus ? draft : null} cut={cut} busy={busy} approved={approved} onApprove={() => void approve()} />
          <Memory fixes={data?.fixes ?? []} busy={busy} onDrift={() => void drift()} onRescan={() => void rescan()} onReset={() => void reset()} />
        </aside>
      </div>
    </main>
  );
}

"use client";

import { CaretDown, Check, CircleNotch, Copy, DownloadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FixPlan } from "@/lib/graph/plan";
import { planToMarkdown } from "@/lib/graph/plan-markdown";
import "./plan.css";

interface Props {
  identity: string | null;
  /** Bump this after a fix is approved or the graph changes, and the plan is worked out again. */
  version: number;
  /** Called with the edge id when a step is clicked (this identity only). */
  onPickEdge: (edgeId: string) => void;
  /** Gets the plan as Markdown whenever it changes, or null when there is none. */
  onMarkdown?: (md: string | null) => void;
}

type Scope = "identity" | "company";
// What came back for one request key (scope, identity, version). A result for an older key counts as "still loading".
type Result = { key: string; plan: FixPlan | null; error: string | null };

const STEPS = 3;

// Plain copy with a fallback for pages where the clipboard API is blocked (for example plain http).
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

export function Plan({ identity, version, onPickEdge, onMarkdown }: Props) {
  const [wanted, setWanted] = useState<Scope>("identity");
  // Without an identity there is nothing to scope to, so the company view is the only one.
  const scope: Scope = identity ? wanted : "company";
  const key = `${scope}|${identity ?? ""}|${version}`;
  const [result, setResult] = useState<Result | null>(null);
  const [ui, setUi] = useState<{ key: string; open: string[]; picked: string | null }>({ key: "", open: [], picked: null });
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const uid = useId();

  useEffect(() => {
    const mine = ++seq.current;
    const ctl = new AbortController();
    const qs = new URLSearchParams({ steps: String(STEPS) });
    if (scope === "identity" && identity) qs.set("from", identity);
    const done = (r: Result) => {
      if (mine === seq.current) setResult(r); // a newer request owns the panel
    };
    (async () => {
      try {
        const res = await fetch(`/api/plan?${qs}`, { signal: ctl.signal });
        const body = await res.json().catch(() => ({}));
        if (body.status === "unknown_entity") done({ key, plan: null, error: `"${body.name}" is not in the graph.` });
        else if (!res.ok || body.status !== "ok") done({ key, plan: null, error: typeof body.error === "string" ? body.error : "Could not work out the plan." });
        else done({ key, plan: body as FixPlan, error: null });
      } catch {
        if (!ctl.signal.aborted) done({ key, plan: null, error: "The server could not be reached." });
      }
    })();
    return () => ctl.abort();
  }, [scope, identity, version, key]);

  const loading = result?.key !== key;
  const error = !loading ? (result?.error ?? null) : null;
  // While the next plan loads, the last good one stays on screen, dimmed.
  const plan = result?.plan ?? null;
  const fresh = !loading ? plan : null;
  const md = useMemo(() => (fresh ? planToMarkdown(fresh) : null), [fresh]);

  const send = useRef(onMarkdown);
  useEffect(() => {
    send.current = onMarkdown;
  });
  useEffect(() => {
    send.current?.(md);
  }, [md]);
  useEffect(() => () => send.current?.(null), []);

  const open = new Set(ui.key === key ? ui.open : []);
  const picked = ui.key === key ? ui.picked : null;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = useCallback(async () => {
    if (md && (await copyText(md))) setCopied(true);
  }, [md]);

  const download = useCallback(() => {
    if (!md) return;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "plan.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [md]);

  const toggle = (id: string) =>
    setUi({ key, picked, open: open.has(id) ? [...open].filter((x) => x !== id) : [...open, id] });

  const company = plan?.scope === "company";
  // The number the headline follows: users in the company view, paths for one identity.
  const track = plan ? (company ? "users" : "paths") : "paths";
  const line = plan ? [plan.before[track], ...plan.steps.map((s) => (track === "users" ? s.usersAfter : s.pathsAfter))] : [];
  const pathLine = plan && company ? [plan.before.paths, ...plan.steps.map((s) => s.pathsAfter)] : [];

  return (
    <section className="plan" aria-labelledby={`${uid}-h`} aria-busy={loading}>
      <div className="plan-head">
        <h2 id={`${uid}-h`}>Fix plan</h2>
        <div className="plan-switch" role="group" aria-label="Plan scope">
          <button type="button" aria-pressed={scope === "identity"} disabled={!identity} onClick={() => setWanted("identity")}>
            This identity
          </button>
          <button type="button" aria-pressed={scope === "company"} onClick={() => setWanted("company")}>
            Whole company
          </button>
        </div>
      </div>

      {error && (
        <p className="plan-alert" role="alert">
          {error}
        </p>
      )}

      {!plan && !error && (
        <p className="plan-quiet" role="status">
          <CircleNotch size={16} weight="bold" className="plan-spin" aria-hidden="true" /> Working out the plan…
        </p>
      )}

      {plan && (
        <div className="plan-body" data-loading={(loading && !error) || undefined}>
          {plan.steps.length === 0 ? (
            <p className="plan-quiet">
              No live attack path is modeled{plan.scope === "identity" ? ` for ${plan.identity}` : ""}. That means none is recorded, not that none exists.
            </p>
          ) : (
            <>
              <p className="plan-sum" aria-label={`${company ? "Users who can reach the crown jewels" : "Attack paths"}: ${line.join(" to ")}`}>
                <span className="plan-sum-label">{company ? "Users who can reach the crown jewels" : "Attack paths to the crown jewels"}</span>
                <span className="plan-seq" aria-hidden="true">
                  {line.map((v, i) => (
                    <span key={i} className={i === line.length - 1 ? "plan-last" : undefined}>
                      {i > 0 && <i className="plan-arrow">to</i>}
                      {v}
                    </span>
                  ))}
                </span>
              </p>
              {company && (
                <p className="plan-sub">
                  Paths: {pathLine.join(" to ")}. A user can have many paths, so the two numbers differ.
                </p>
              )}

              <ol className="plan-steps">
                {plan.steps.map((s, i) => {
                  const id = `${uid}-t${i}`;
                  const shown = open.has(s.edgeId);
                  const left = plan.before.paths ? Math.max(0, Math.min(100, (s.pathsAfter / plan.before.paths) * 100)) : 0;
                  const title = <span className="plan-title">{s.ticket.title}</span>;
                  return (
                    <li key={s.edgeId} className="plan-step" data-picked={picked === s.edgeId || undefined}>
                      <span className="plan-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <div className="plan-main">
                        {plan.scope === "identity" ? (
                          <button
                            type="button"
                            className="plan-pick"
                            aria-current={picked === s.edgeId ? "true" : undefined}
                            onClick={() => {
                              setUi({ key, open: [...open], picked: s.edgeId });
                              onPickEdge(s.edgeId);
                            }}
                          >
                            <span className="plan-sr">Step {i + 1}: </span>
                            {title}
                          </button>
                        ) : (
                          <p className="plan-pick-static">
                            <span className="plan-sr">Step {i + 1}: </span>
                            {title}
                          </p>
                        )}
                        <p className="plan-meta">
                          <code>{s.type}</code>
                          <span>
                            cuts <b>{n(s.killed, "path", "paths")}</b>
                          </span>
                          {company && <span>{n(s.usersAfter, "user", "users")} left</span>}
                        </p>
                        <div className="plan-left">
                          <div className="plan-bar" role="img" aria-label={`${s.pathsAfter} of ${plan.before.paths} paths left after this step`}>
                            <span style={{ width: `${left}%` }} />
                          </div>
                          <span className="plan-left-n">{s.pathsAfter} left</span>
                        </div>
                        <button type="button" className="plan-more" aria-expanded={shown} aria-controls={id} onClick={() => toggle(s.edgeId)}>
                          <CaretDown size={14} weight="bold" aria-hidden="true" className="plan-caret" />
                          {shown ? "Hide ticket" : "Show ticket"}
                        </button>
                        {shown && (
                          <div className="plan-ticket" id={id}>
                            <h3>{s.ticket.title}</h3>
                            <p>{s.ticket.body}</p>
                            <pre>{s.ticket.command}</pre>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="plan-actions">
                <button type="button" className="plan-btn" onClick={copy} disabled={!md}>
                  {copied ? <Check size={16} weight="bold" aria-hidden="true" /> : <Copy size={16} weight="bold" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy plan"}
                </button>
                <button type="button" className="plan-btn" onClick={download} disabled={!md}>
                  <DownloadSimple size={16} weight="bold" aria-hidden="true" />
                  Download plan.md
                </button>
                <span className="plan-sr" role="status" aria-live="polite">
                  {copied ? "Plan copied to the clipboard" : ""}
                </span>
              </div>
            </>
          )}
          <p className="plan-honest">This plan is advice. It changes nothing until a person approves each fix.</p>
        </div>
      )}
    </section>
  );
}

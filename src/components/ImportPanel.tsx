"use client";

import { CaretRight, DownloadSimple, FileCsv, Lightning, UploadSimple, X } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import { LIMITS, SAMPLE_CROWN, SAMPLE_NAME, sampleCsv } from "@/lib/graph/import";
import "./import.css";

interface Props {
  sandbox: boolean;
  custom: boolean;
  busy: boolean;
  onImported: (r: { suggested: string; dataset: { name: string; custom: boolean } }) => void;
  onBackToDemo: () => void;
}

interface Picked {
  name: string;
  size: number;
  text: string;
}

const EXAMPLE = `type,from,to,note
MEMBER_OF,alice,Helpdesk,
ADMIN_ON,Helpdesk,PC-07,
HAS_SESSION,PC-07,adm-bob,
MEMBER_OF,adm-bob,Domain Admins,
ADMIN_ON,Domain Admins,DC01,`;

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(2)} MB`);

export function ImportPanel({ sandbox, custom, busy, onImported, onBackToDemo }: Props) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pasted, setPasted] = useState("");
  const [crown, setCrown] = useState("");
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const locked = !sandbox || busy || working;

  function pickFile(file: File | undefined) {
    if (!file) return;
    setErrors([]);
    if (file.size > LIMITS.bytes) {
      setPicked(null);
      setStatus("");
      setErrors([`${file.name} is ${kb(file.size)}. The limit is 1 MB.`]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPicked({ name: file.name, size: file.size, text: String(reader.result ?? "") });
      setStatus(`Loaded ${file.name} (${kb(file.size)}).`);
    };
    reader.onerror = () => {
      setPicked(null);
      setErrors(["That file could not be read."]);
    };
    reader.readAsText(file);
  }

  function clearFile() {
    setPicked(null);
    setStatus("File removed.");
    if (fileInput.current) fileInput.current.value = "";
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([sampleCsv()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "contoso-retail-sample.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function run(csv: string, crownText: string, datasetName: string) {
    const crownNames = crownText.split(",").map((c) => c.trim()).filter(Boolean);
    setErrors([]);
    if (!csv.trim()) {
      setStatus("");
      setErrors(["Choose a file or paste your edge list first."]);
      return;
    }
    if (!crownNames.length) {
      setStatus("");
      setErrors(["Name at least one crown jewel, separated by commas."]);
      return;
    }
    setWorking(true);
    setStatus("Importing...");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, crown: crownNames, name: datasetName.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        const s = body.summary as { nodes: number; edges: number };
        setStatus(
          body.noPaths
            ? `Imported ${s.nodes} nodes and ${s.edges} edges, but nobody can reach a crown jewel yet. Check the crown names.`
            : `Imported ${s.nodes} nodes and ${s.edges} edges. Tracing ${body.suggested}.`,
        );
        onImported({ suggested: body.suggested, dataset: body.dataset });
      } else if (Array.isArray(body.errors)) {
        setStatus(`${body.errors.length} ${body.errors.length === 1 ? "problem" : "problems"} found. Nothing was imported.`);
        setErrors(body.errors);
      } else {
        setStatus("");
        setErrors([typeof body.error === "string" ? body.error : "The import failed. Try again."]);
      }
    } catch {
      setStatus("");
      setErrors(["The server could not be reached."]);
    } finally {
      setWorking(false);
    }
  }

  function trySample() {
    const csv = sampleCsv();
    setPicked(null);
    setPasted(csv);
    setCrown(SAMPLE_CROWN.join(", "));
    setName(SAMPLE_NAME);
    void run(csv, SAMPLE_CROWN.join(", "), SAMPLE_NAME);
  }

  return (
    <details className="imp">
      <summary>
        <CaretRight className="imp-caret" weight="bold" aria-hidden="true" />
        <span className="imp-title">Use your own data</span>
        {custom && <span className="imp-tag">custom data loaded</span>}
      </summary>

      <div className="imp-body">
        {!sandbox && <p className="imp-lock">Reload the page to get your own sandbox, then import.</p>}

        <p className="imp-copy">
          Load an edge list and run the same trace, plan and ticket on it. One row per link, with a header row. Types are{" "}
          <code>MEMBER_OF</code>, <code>ADMIN_ON</code>, <code>HAS_SESSION</code> and <code>CAN_READ</code>. Names are read as users, groups, hosts and
          secrets from how you use them. Extra columns are ignored.
        </p>
        <pre className="imp-example" aria-label="Example edge list">{EXAMPLE}</pre>

        <div className="imp-row">
          <button type="button" className="imp-btn hot" onClick={trySample} disabled={locked}>
            <Lightning weight="bold" aria-hidden="true" /> Try the sample
          </button>
          <button type="button" className="imp-btn" onClick={downloadSample}>
            <DownloadSimple weight="bold" aria-hidden="true" /> Download sample CSV
          </button>
        </div>

        <div className="imp-field">
          <span className="imp-label" id={`${id}-file-l`}>Edge list file</span>
          <div className="imp-row">
            <label className={`imp-btn${locked ? " off" : ""}`} htmlFor={`${id}-file`}>
              <UploadSimple weight="bold" aria-hidden="true" /> Choose a .csv file
            </label>
            <input
              id={`${id}-file`}
              ref={fileInput}
              className="imp-file"
              type="file"
              accept=".csv,text/csv"
              disabled={locked}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {picked && (
              <span className="imp-picked">
                <FileCsv weight="bold" aria-hidden="true" />
                <span className="mono">{picked.name}</span>
                <span className="imp-dim">{kb(picked.size)}</span>
                <button type="button" className="imp-x" onClick={clearFile} disabled={locked} aria-label={`Remove ${picked.name}`}>
                  <X weight="bold" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        </div>

        {!picked && (
          <div className="imp-field">
            <label className="imp-label" htmlFor={`${id}-paste`}>Or paste it here</label>
            <textarea
              id={`${id}-paste`}
              className="imp-input imp-paste"
              rows={5}
              spellCheck={false}
              placeholder="type,from,to,note"
              value={pasted}
              disabled={locked}
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>
        )}

        <div className="imp-two">
          <div className="imp-field">
            <label className="imp-label" htmlFor={`${id}-crown`}>Crown jewel names (comma separated)</label>
            <input
              id={`${id}-crown`}
              className="imp-input"
              type="text"
              placeholder="DC01, secret:prod-db-creds"
              value={crown}
              disabled={locked}
              autoComplete="off"
              onChange={(e) => setCrown(e.target.value)}
            />
          </div>
          <div className="imp-field">
            <label className="imp-label" htmlFor={`${id}-name`}>Dataset name (optional)</label>
            <input
              id={`${id}-name`}
              className="imp-input"
              type="text"
              maxLength={40}
              placeholder="Your data"
              value={name}
              disabled={locked}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <div className="imp-row">
          <button type="button" className="imp-btn hot" disabled={locked} onClick={() => void run(picked ? picked.text : pasted, crown, name)}>
            Import
          </button>
          {custom && (
            <button type="button" className="imp-btn" disabled={!sandbox || busy || working} onClick={onBackToDemo}>
              Back to the Northwind demo
            </button>
          )}
        </div>

        <p className="imp-status" role="status" aria-live="polite">{status}</p>
        {errors.length > 0 && (
          <ul className="imp-errors" aria-label="Problems found">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}

        <p className="imp-note">Your data stays in a private sandbox graph that expires after a few hours. Do not upload real credentials.</p>
      </div>
    </details>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, DownloadSimple } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import "./copy.css";

interface Props {
  getText: () => string | null;
  filename: string;
  label?: string;
}

type Status = "idle" | "copied" | "failed";

export function CopyButtons({ getText, filename, label = "Copy" }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = getText() !== null;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = useCallback((next: Status) => {
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  }, []);

  const copy = async () => {
    const text = getText();
    if (text === null) return;
    flash((await copyText(text)) ? "copied" : "failed");
  };

  const download = () => {
    const text = getText();
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a moment to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="cp-bar">
      <button type="button" className={`cp-btn${status === "copied" ? " done" : ""}`} disabled={!ready} onClick={() => void copy()}>
        {status === "copied" ? <Check size={16} weight="bold" aria-hidden="true" /> : <Copy size={16} weight="bold" aria-hidden="true" />}
        {label}
      </button>
      <button type="button" className="cp-btn" disabled={!ready} onClick={download}>
        <DownloadSimple size={16} weight="bold" aria-hidden="true" />
        Download .md
      </button>
      <span className={`cp-status${status === "failed" ? " fail" : ""}`} role="status" aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed. Select the text by hand." : ""}
      </span>
    </div>
  );
}

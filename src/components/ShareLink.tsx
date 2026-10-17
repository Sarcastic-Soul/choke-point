"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LinkSimple } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import "./copy.css";

interface Props {
  getUrl: () => string | null;
}

type Status = "idle" | "copied" | "failed";

export function ShareLink({ getUrl }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    const url = getUrl();
    if (url === null) return;
    setStatus((await copyText(url)) ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <span className="cp-bar">
      <button type="button" className={`cp-btn${status === "copied" ? " done" : ""}`} onClick={() => void copy()}>
        {status === "copied" ? <Check size={16} weight="bold" aria-hidden="true" /> : <LinkSimple size={16} weight="bold" aria-hidden="true" />}
        Copy link
      </button>
      <span className={`cp-status${status === "failed" ? " fail" : ""}`} role="status" aria-live="polite">
        {status === "copied" ? "Link copied" : status === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  );
}

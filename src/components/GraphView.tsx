"use client";

import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import { mono } from "@/lib/fonts";
import { analyze, layout, type PathGraph } from "@/lib/view";

const C = { paper: "#f2ede2", ink: "#1e1b16", mute: "#6f685a", rule: "#cfc7b4", hot: "#c93418" };

interface Props {
  graph: PathGraph;
  cutEdge: string | null;
  selected: string | null;
  freshSince: number | null;
  onSelect: (id: string | null) => void;
}

export function GraphView({ graph, cutEdge, selected, freshSince, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const select = useRef(onSelect);
  useEffect(() => { select.current = onSelect; });

  // Build the graph when the data changes.
  useEffect(() => {
    if (!box.current) return;
    const pos = layout(graph, 118, 64);
    const { edgeUse } = analyze(graph);
    const maxUse = Math.max(1, ...edgeUse.values());
    const family = mono.style.fontFamily.split(",")[0].replace(/['"]/g, "").trim();

    const instance = cytoscape({
      container: box.current,
      maxZoom: 1.2,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      elements: [
        ...graph.nodes.map((n) => ({
          data: { id: n.id, label: n.id, kind: n.kind, crown: n.crown ? 1 : 0, alt: Math.round(pos.get(n.id)!.x / 118) % 2 },
          position: pos.get(n.id)!,
        })),
        { data: { id: "__pad", kind: "pad", crown: 0, alt: 0 }, position: { x: Math.max(0, ...[...pos.values()].map((p) => p.x)) + 170, y: 0 }, classes: "pad" },
        ...graph.edges.map((e) => ({
          data: { id: e.id, source: e.source, target: e.target, w: 2 + 6 * ((edgeUse.get(e.id) ?? 0) / maxUse), fresh: freshSince && e.addedAt > freshSince ? 1 : 0 },
        })),
      ],
      layout: { name: "preset", padding: 30 },
      style: [
        {
          selector: "node",
          style: {
            width: 14, height: 14, shape: "rectangle", "background-color": C.paper, "border-width": 2.5, "border-color": C.ink,
            label: "", "font-family": family, "font-size": 17, color: C.ink, "text-valign": "top", "text-margin-y": -7,
            "text-background-color": C.paper, "text-background-opacity": 0.85, "text-background-padding": "2px",
          },
        },
        { selector: "node.pad", style: { opacity: 0, events: "no", width: 1, height: 1, "border-width": 0 } },
        { selector: "node[alt > 0]", style: { "text-valign": "bottom", "text-margin-y": 7 } },
        { selector: "node.name, node:selected", style: { label: "data(label)" } },
        { selector: 'node[kind = "User"]', style: { "background-color": C.ink } },
        { selector: 'node[kind = "Host"]', style: { shape: "ellipse" } },
        { selector: 'node[kind = "Secret"]', style: { shape: "diamond", width: 17, height: 17 } },
        { selector: "node[crown > 0]", style: { shape: "ellipse", width: 22, height: 22, "background-color": C.hot, "border-color": C.hot, color: C.hot, "font-weight": 600, "text-valign": "center", "text-halign": "right", "text-margin-y": 0, "text-margin-x": 8 } },
        {
          selector: "edge",
          style: {
            "curve-style": "taxi", "taxi-direction": "rightward", "taxi-turn": "50%", width: "data(w)", "line-color": C.hot,
            "transition-property": "line-color, width, opacity", "transition-duration": window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
          },
        },
        { selector: "edge[fresh > 0]", style: { "line-color": C.ink, "line-style": "dashed", label: "new", "font-family": family, "font-size": 15, color: C.ink, "text-background-color": C.paper, "text-background-opacity": 1 } },
        { selector: "edge.dead", style: { "line-color": C.rule, width: 1.5, "line-style": "dashed", opacity: 0.8 } },
        { selector: "edge.cut", style: { label: "✕", "font-size": 22, color: C.ink, "text-background-color": C.paper, "text-background-opacity": 1, "text-background-padding": "1px", "text-rotation": "none" } },
        { selector: "edge.pick", style: { "underlay-color": C.ink, "underlay-opacity": 0.14, "underlay-padding": 5 } },
        { selector: "node.gone", style: { opacity: 0.35 } },
      ],
    });
    instance.nodes().forEach((n) => { if (n.id() === graph.from || n.data("crown") || n.data("kind") === "Group") n.addClass("name"); });
    instance.on("mouseover", "node", (ev) => ev.target.addClass("name"));
    instance.on("mouseout", "node", (ev) => { const n = ev.target; if (!(n.id() === graph.from || n.data("crown") || n.data("kind") === "Group")) n.removeClass("name"); });
    instance.on("tap", "edge", (ev) => select.current(ev.target.id()));
    instance.on("tap", (ev) => { if (ev.target === instance) select.current(null); });
    instance.on("mouseover", "edge", () => { if (box.current) box.current.style.cursor = "pointer"; });
    instance.on("mouseout", "edge", () => { if (box.current) box.current.style.cursor = "default"; });
    cy.current = instance;

    const fit = () => { instance.resize(); instance.fit(undefined, 36); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    let disposed = false;
    document.fonts?.ready.then(() => { if (!disposed) instance.style().update(); });
    return () => { disposed = true; ro.disconnect(); instance.destroy(); cy.current = null; };
  }, [graph, freshSince]);

  // Preview the cut and the selection without rebuilding.
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.edges().removeClass("dead cut pick");
    c.nodes().removeClass("gone");
    if (cutEdge) {
      const { edgeUse } = analyze(graph, cutEdge);
      graph.edges.forEach((e) => {
        if (e.id === cutEdge) c.getElementById(e.id).addClass("dead cut");
        else if (!edgeUse.get(e.id)) c.getElementById(e.id).addClass("dead");
      });
      const alive = new Set(graph.edges.filter((e) => edgeUse.get(e.id)).flatMap((e) => [e.source, e.target]));
      graph.nodes.forEach((n) => { if (!alive.has(n.id) && n.id !== graph.from) c.getElementById(n.id).addClass("gone"); });
    }
    if (selected) c.getElementById(selected).addClass("pick");
  }, [graph, cutEdge, selected]);

  return <div ref={box} className="graph" role="img" aria-label={`Attack paths from ${graph.from} to the crown jewels`} />;
}

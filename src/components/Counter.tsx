"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

function useTween(value: number) {
  const [shown, setShown] = useState(value);
  const last = useRef(value);
  const calm = useReducedMotion();
  useEffect(() => {
    const control = animate(last.current, value, {
      duration: calm ? 0 : 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (x) => { last.current = x; setShown(Math.round(x)); },
    });
    return () => control.stop();
  }, [value, calm]);
  return shown;
}

interface Props {
  before: number;
  after: number | null;
  caption: string;
}

export function Counter({ before, after, caption }: Props) {
  const old = useTween(before);
  const next = useTween(after ?? before);
  return (
    <div className="counter">
      <span className="sr" role="status">{after === null ? `${before} ${caption}` : `${before} paths before, ${after} after. ${caption}`}</span>
      <div aria-hidden="true" style={{ display: "contents" }}>
        {after === null ? (
          <span className="n">{old}</span>
        ) : (
          <>
            <span className="n old">{old}</span>
            <span className="n new">{next}</span>
          </>
        )}
      </div>
      <p aria-hidden="true">{caption}</p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

const fallbackQuotes = [
  "Let the voices sharpen the idea.",
  "A great argument is a clarity engine.",
  "Teach me in one sentence, then prove it.",
  "Tension first, insight second.",
  "Every strong point deserves a stronger counterpoint."
];

interface LoadingOverlayProps {
  visible: boolean;
  phaseLabel: string;
}

export function LoadingOverlay({ visible, phaseLabel }: LoadingOverlayProps) {
  const quotes = useMemo(() => fallbackQuotes, []);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const interval = setInterval(() => {
      setIndex((value: number) => (value + 1) % quotes.length);
    }, 1700);
    return () => clearInterval(interval);
  }, [visible, quotes.length]);

  if (!visible) {
    return null;
  }

  return (
    <div className="loadingOverlay" role="status" aria-live="polite">
      <div className="loadingCard">
        <div className="spinner" />
        <p className="loadingLabel">{phaseLabel}</p>
        <p className="loadingQuote">{quotes[index]}</p>
      </div>
    </div>
  );
}

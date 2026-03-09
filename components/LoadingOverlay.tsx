"use client";

import { useEffect, useRef, useState } from "react";

const PHASES = [
  "Classifying intent…",
  "Routing to best mode…",
  "Preparing agents…",
  "Connecting audio stream…",
  "Warming up voices…",
];

const FACTS = [
  "Let the voices sharpen the idea.",
  "A great argument is a clarity engine.",
  "Tension first, insight second.",
  "Every strong point deserves a stronger counterpoint.",
  "Teach me in one sentence, then prove it.",
];

interface LoadingOverlayProps {
  visible: boolean;
  phaseLabel: string;
}

export function LoadingOverlay({ visible, phaseLabel }: LoadingOverlayProps) {
  const [cyclePhase, setCyclePhase] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [factVisible, setFactVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Cycle phase text every 2s
  useEffect(() => {
    if (!visible) return;
    const iv = setInterval(() => setCyclePhase((p) => (p + 1) % PHASES.length), 2000);
    return () => clearInterval(iv);
  }, [visible]);

  // Cycle facts every 3.4s with CSS fade
  useEffect(() => {
    if (!visible) return;
    const iv = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => {
        setFactIndex((i) => (i + 1) % FACTS.length);
        setFactVisible(true);
      }, 350);
    }, 3400);
    return () => clearInterval(iv);
  }, [visible]);

  // GSAP scale-in on mount
  useEffect(() => {
    if (!visible || !cardRef.current) return;
    import("gsap").then(({ gsap }) => {
      gsap.fromTo(
        cardRef.current,
        { scale: 0.9, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }
      );
    });
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="loadingOverlay" role="status" aria-live="polite">
      <div ref={cardRef} className="loadingCard">
        {/* 12 pulsing waveform bars */}
        <div className="loadingBars" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="loadingBar" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>

        <p className="loadingLabel">{phaseLabel || PHASES[cyclePhase]}</p>
        <p
          className="loadingQuote"
          style={{ opacity: factVisible ? 1 : 0, transition: "opacity 0.35s ease" }}
        >
          {FACTS[factIndex]}
        </p>
      </div>
    </div>
  );
}

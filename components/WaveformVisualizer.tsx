"use client";

import { useEffect, useRef } from "react";
import type { Speaker } from "../lib/types";

interface WaveformVisualizerProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isActive: boolean;
  nowSpeaking: Speaker | null;
}

const COLOR_A = "#6366f1"; // indigo
const COLOR_B = "#f59e0b"; // amber
const BAR_COUNT = 64;

export function WaveformVisualizer({ audioRef, isActive, nowSpeaking }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Create AudioContext + AnalyserNode once when audio is available
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || analyserRef.current) return;

    const setup = () => {
      if (analyserRef.current) return;
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyserRef.current = analyser;
        dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        const source = ctx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(ctx.destination);
      } catch {
        // AudioContext creation failed — silently skip
      }
    };

    // Resume context when audio plays
    const onPlay = () => {
      if (!analyserRef.current) setup();
      audioCtxRef.current?.resume().catch(() => null);
    };

    audio.addEventListener("play", onPlay);
    return () => audio.removeEventListener("play", onPlay);
  }, [audioRef]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const color = nowSpeaking === "B" ? COLOR_B : COLOR_A;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barW = W / BAR_COUNT - 1;

      if (isActive && analyserRef.current && dataRef.current) {
        analyserRef.current.getByteFrequencyData(dataRef.current);
        for (let i = 0; i < BAR_COUNT; i++) {
          const val = dataRef.current[i] / 255;
          const barH = Math.max(2, val * H * 0.9);
          const x = i * (barW + 1);
          const alpha = 0.4 + val * 0.6;
          ctx.fillStyle = color.replace(")", `,${alpha})`).replace("rgb", "rgba").replace("#", "");
          // Use hex directly
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillRect(x, H - barH, barW, barH);
        }
        ctx.globalAlpha = 1;
      } else {
        // Flat idle line — no animation until agent is speaking
        for (let i = 0; i < BAR_COUNT; i++) {
          const x = i * (barW + 1);
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = color;
          ctx.fillRect(x, H - 2, barW, 2);
        }
        ctx.globalAlpha = 1;
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, nowSpeaking]);

  return (
    <canvas
      ref={canvasRef}
      className="waveformCanvas"
      width={320}
      height={56}
      aria-hidden="true"
    />
  );
}

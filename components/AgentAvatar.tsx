"use client";

import { useEffect, useRef } from "react";
import type { Speaker } from "../lib/types";

interface AgentAvatarProps {
  agent: Speaker;
  isActive: boolean;
  phase?: string;
}

export function AgentAvatar({ agent, isActive, phase }: AgentAvatarProps) {
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const floatRef = useRef<ReturnType<typeof import("gsap").gsap.to> | null>(null);

  // Idle float animation
  useEffect(() => {
    import("gsap").then(({ gsap }) => {
      if (!avatarRef.current) return;
      if (floatRef.current) floatRef.current.kill();
      floatRef.current = gsap.to(avatarRef.current, {
        y: -6,
        duration: 2.2 + (agent === "B" ? 0.4 : 0),
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    });
    return () => {
      floatRef.current?.kill();
    };
  }, [agent]);

  const isThinking = phase === "connecting";

  return (
    <div
      ref={avatarRef}
      className={`agentAvatarWrap agentAvatarWrap--${agent.toLowerCase()} ${isActive ? "agentAvatarWrap--active" : ""}`}
    >
      {/* Speaking rings */}
      {isActive && !isThinking && (
        <>
          <div className="speakingRing speakingRing--1" />
          <div className="speakingRing speakingRing--2" />
        </>
      )}

      {/* SVG geometric avatar or thinking dots */}
      {isThinking ? (
        <div className="thinkingDots">
          <span /><span /><span />
        </div>
      ) : (
        <svg
          className="agentSvg"
          width="72"
          height="72"
          viewBox="0 0 72 72"
          fill="none"
          aria-label={`Agent ${agent}`}
        >
          {agent === "A" ? (
            <>
              {/* Agent A: diamond + inner triangle */}
              <polygon
                points="36,6 64,36 36,66 8,36"
                fill={isActive ? "rgba(99,102,241,0.25)" : "rgba(30,41,59,0.8)"}
                stroke={isActive ? "#6366f1" : "rgba(137,180,214,0.35)"}
                strokeWidth="1.5"
              />
              <polygon
                points="36,20 50,40 22,40"
                fill={isActive ? "rgba(99,102,241,0.6)" : "rgba(99,102,241,0.2)"}
              />
            </>
          ) : (
            <>
              {/* Agent B: hexagon + inner circle */}
              <polygon
                points="36,5 62,20 62,52 36,67 10,52 10,20"
                fill={isActive ? "rgba(245,158,11,0.2)" : "rgba(30,41,59,0.8)"}
                stroke={isActive ? "#f59e0b" : "rgba(137,180,214,0.35)"}
                strokeWidth="1.5"
              />
              <circle
                cx="36"
                cy="36"
                r="11"
                fill={isActive ? "rgba(245,158,11,0.6)" : "rgba(245,158,11,0.2)"}
              />
            </>
          )}
        </svg>
      )}

      <span className="agentLabel">Agent {agent}</span>
    </div>
  );
}

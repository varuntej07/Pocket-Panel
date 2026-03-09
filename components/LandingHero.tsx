"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LandingHeroProps {
  onStart: () => void;
  onTopicSelect?: (topic: string) => void;
}

const TOPICS = [
  "AI vs Human Creativity",
  "Universal Basic Income",
  "Nuclear Energy Future",
  "Privacy vs Security",
  "Gene Editing Ethics",
  "Space Colonization",
  "Social Media Regulation",
  "Climate Policy Tradeoffs",
  "Cryptocurrency vs Banks",
  "Consciousness & Machines",
  "Four-Day Work Week",
  "Lab-Grown Meat Ethics",
];

const HOW_IT_WORKS = [
  {
    icon: "◈",
    number: "01",
    title: "Enter a Topic",
    desc: "Type any debate topic, question, or argument you want two AI voices to explore in real time.",
  },
  {
    icon: "◉",
    number: "02",
    title: "Pick a Mode",
    desc: "Choose from 31 formats — classical debate, Socratic dialogue, podcast, host-guest deep dive, and more.",
  },
  {
    icon: "◎",
    number: "03",
    title: "Listen Live",
    desc: "Two AI agents debate your topic with real-time voice synthesis. Inject your own questions mid-debate.",
  },
];

const DEMO_SCRIPT: { agent: "A" | "B"; text: string }[] = [
  {
    agent: "A",
    text: "Universal basic income rests on three pillars: automation displacement, subsistence dignity, and economic stimulus.",
  },
  {
    agent: "B",
    text: "Those pillars crumble under fiscal reality — the taxation required undermines the very engine it claims to stimulate.",
  },
  {
    agent: "A",
    text: "History disagrees. Alaska's Permanent Fund has run for decades without economic collapse of any kind.",
  },
  {
    agent: "B",
    text: "A resource dividend is categorically different from universal income. You're conflating two distinct policy mechanisms.",
  },
];

export function LandingHero({ onStart, onTopicSelect }: LandingHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctaBtnRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const gsapCleanupRef = useRef<(() => void) | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<"A" | "B" | null>(null);
  const [demoLineA, setDemoLineA] = useState("");
  const [demoLineB, setDemoLineB] = useState("");
  const [demoStep, setDemoStep] = useState(-1);

  // ─── Neural Constellation Canvas ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    interface Node {
      x: number; y: number; vx: number; vy: number;
      r: number; ci: number; pulse: number; pd: number;
    }

    const PALETTE = ["rgba(0,245,255,", "rgba(255,0,204,", "rgba(255,215,0,"];
    let W = 0, H = 0;
    const nodes: Node[] = [];

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 72; i++) {
      nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.8 + 0.6,
        ci: Math.floor(Math.random() * 3),
        pulse: Math.random(), pd: Math.random() > 0.5 ? 1 : -1,
      });
    }

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (const n of nodes) {
        const dx = n.x - mx, dy = n.y - my;
        const md = Math.sqrt(dx * dx + dy * dy);
        if (md < 120 && md > 0) {
          const f = ((120 - md) / 120) * 0.25;
          n.vx += (dx / md) * f;
          n.vy += (dy / md) * f;
        }
        n.vx *= 0.985; n.vy *= 0.985;
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        n.pulse += n.pd * 0.008;
        if (n.pulse > 1 || n.pulse < 0) n.pd *= -1;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            const alpha = (1 - dist / 140) * 0.4;
            const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            g.addColorStop(0, PALETTE[a.ci] + alpha + ")");
            g.addColorStop(1, PALETTE[b.ci] + alpha + ")");
            ctx.beginPath();
            ctx.strokeStyle = g;
            ctx.lineWidth = (1 - dist / 140) * 1.4;
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const a = 0.35 + n.pulse * 0.65;
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
        glow.addColorStop(0, PALETTE[n.ci] + a + ")");
        glow.addColorStop(1, PALETTE[n.ci] + "0)");
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE[n.ci] + a + ")"; ctx.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Mouse tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    const onLeave = () => { mouseRef.current = { x: -9999, y: -9999 }; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // ─── GSAP Animations ───────────────────────────────────────────────────────
  useEffect(() => {
    let killed = false;

    const init = async () => {
      try {
        const { gsap } = await import("gsap");
        const { ScrollTrigger } = await import("gsap/ScrollTrigger");
        if (killed) return;

        gsap.registerPlugin(ScrollTrigger);

        // ── Portal opening
        const portalTl = gsap.timeline();
        portalTl
          .fromTo(".lh-portal-overlay",
            { opacity: 1 },
            { opacity: 0, duration: 1.4, ease: "power2.inOut", onComplete: () => {
                const el = document.querySelector(".lh-portal-overlay") as HTMLElement | null;
                if (el) el.style.pointerEvents = "none";
              }
            }, 0)
          .fromTo(".lh-portal-ring",
            { scale: 0, opacity: 0.9 },
            { scale: 5, opacity: 0, duration: 2, stagger: 0.25, ease: "power3.out" }, 0)
          .fromTo(".lh-orb",
            { scale: 0, opacity: 0 },
            { scale: 1, opacity: 1, duration: 2, stagger: 0.2, ease: "power3.out" }, 0.1);

        // ── Hero title — 3D flip-in per word
        const titleEl = titleRef.current;
        if (titleEl) {
          portalTl.set(titleEl, { opacity: 1 });
          portalTl.fromTo(".lh-title-word",
            { opacity: 0, y: 90, rotateX: -100, transformOrigin: "center bottom", transformPerspective: 900 },
            {
              opacity: 1, y: 0, rotateX: 0,
              duration: 0.85, stagger: 0.18,
              ease: "back.out(2.2)",
            }, 0.9);
        }

        // ── Subtitle
        portalTl
          .fromTo(".lh-sub",
            { opacity: 0, y: 22 },
            { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 1.85)
          .fromTo(".lh-sw-bar",
            { scaleY: 0 },
            { scaleY: 1, duration: 0.45, stagger: { from: "center", each: 0.035 }, ease: "back.out(2.5)" }, 1.9);

        // ── CTA
        portalTl.fromTo(".lh-cta-wrap",
          { opacity: 0, y: 28, scale: 0.9 },
          { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.8)" }, 2.2);

        // ── Chips
        portalTl.fromTo(".lh-chip",
          { opacity: 0, scale: 0.4, y: 40 },
          {
            opacity: 1, scale: 1, y: 0, duration: 0.65,
            stagger: { each: 0.07, from: "random" },
            ease: "back.out(1.8)"
          }, 2.1);

        // Continuous CTA glow pulse
        gsap.to(".lh-cta", {
          boxShadow: [
            "0 0 40px rgba(0,245,255,0.6), 0 0 80px rgba(255,0,204,0.25), 0 0 120px rgba(255,215,0,0.12)",
            "0 0 20px rgba(0,245,255,0.3), 0 0 40px rgba(255,0,204,0.1)",
          ].join(" → "),
          duration: 2.4,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: 2.8,
        });

        // 3D floating for chips
        if (!killed) {
          document.querySelectorAll<HTMLElement>(".lh-chip").forEach((chip, i) => {
            gsap.to(chip, {
              y: `random(-10, 10)`,
              rotateZ: `random(-5, 5)`,
              rotateY: `random(-10, 10)`,
              duration: gsap.utils.random(2.5, 5.5),
              repeat: -1, yoyo: true,
              ease: "sine.inOut",
              delay: i * 0.13,
            });
          });
        }

        // ── How It Works — ScrollTrigger
        if (!killed) {
          document.querySelectorAll<HTMLElement>(".lh-how-card").forEach((card, i) => {
            const dir = i % 2 === 0 ? -1 : 1;
            gsap.fromTo(card,
              { opacity: 0, x: dir * 80, rotateY: dir * 30, z: -200, transformPerspective: 800, transformOrigin: "center center" },
              {
                opacity: 1, x: 0, rotateY: 0, z: 0,
                duration: 1.1, ease: "power3.out",
                scrollTrigger: { trigger: card, start: "top 88%", toggleActions: "play none none reverse" },
              });
          });

          gsap.fromTo(".lh-connector-line",
            { scaleX: 0, transformOrigin: "left center" },
            {
              scaleX: 1, duration: 1.2, ease: "power2.inOut",
              scrollTrigger: { trigger: ".lh-how", start: "top 72%", toggleActions: "play none none reverse" },
            });

          gsap.fromTo(".lh-how-heading",
            { opacity: 0, y: 40 },
            {
              opacity: 1, y: 0, duration: 0.8, ease: "power2.out",
              scrollTrigger: { trigger: ".lh-how", start: "top 85%", toggleActions: "play none none reverse" },
            });

          // Icon audio-wave pulse
          document.querySelectorAll<HTMLElement>(".lh-hw-bar").forEach((bar, i) => {
            gsap.to(bar, {
              scaleY: `random(0.3, 1.8)`,
              duration: `random(0.3, 0.7)`,
              repeat: -1, yoyo: true,
              ease: "sine.inOut",
              delay: i * 0.08,
            });
          });
        }

        gsapCleanupRef.current = () => {
          ScrollTrigger.getAll().forEach((t) => t.kill());
          gsap.killTweensOf("*");
        };
      } catch {
        // GSAP unavailable — elements visible by default via fallback CSS
        document.querySelectorAll<HTMLElement>(".lh-title,.lh-sub,.lh-cta-wrap,.lh-badge,.lh-chip,.lh-how-card").forEach((el) => {
          el.style.opacity = "1";
        });
      }
    };

    void init();
    return () => {
      killed = true;
      gsapCleanupRef.current?.();
    };
  }, []);

  // ─── CTA Button handlers ───────────────────────────────────────────────────
  const handleCtaMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = ctaBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width / 2)) * 0.22;
    const dy = (e.clientY - (rect.top + rect.height / 2)) * 0.22;
    import("gsap").then(({ gsap }) => {
      gsap.to(btn, { x: dx, y: dy, duration: 0.28, ease: "power2.out" });
    });
  }, []);

  const handleCtaMouseLeave = useCallback(() => {
    import("gsap").then(({ gsap }) => {
      gsap.to(ctaBtnRef.current, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" });
    });
  }, []);

  const handleCtaHover = useCallback(() => {
    import("gsap").then(({ gsap }) => {
      gsap.fromTo(".lh-energy-ring",
        { scale: 1, opacity: 0.8 },
        { scale: 2.8, opacity: 0, duration: 0.9, stagger: 0.18, ease: "power2.out" });
    });
  }, []);

  const fireParticleBurst = useCallback(() => {
    const btn = ctaBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ["#00f5ff", "#ff00cc", "#ffd700", "#ffffff"];

    import("gsap").then(({ gsap }) => {
      gsap.to(btn, { scale: 0.92, duration: 0.08, yoyo: true, repeat: 1 });
      for (let i = 0; i < 24; i++) {
        const p = document.createElement("div");
        p.className = "lh-burst-particle";
        p.style.left = cx + "px";
        p.style.top = cy + "px";
        p.style.background = colors[i % colors.length];
        document.body.appendChild(p);
        const angle = (i / 24) * Math.PI * 2;
        const dist = 70 + Math.random() * 90;
        gsap.to(p, {
          x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
          opacity: 0, scale: Math.random() * 1.5 + 0.4,
          duration: 0.7 + Math.random() * 0.4, ease: "power2.out",
          onComplete: () => p.remove(),
        });
      }
    });
  }, []);

  const handleCtaClick = useCallback(() => {
    fireParticleBurst();
    setTimeout(onStart, 320);
  }, [fireParticleBurst, onStart]);

  // ─── Chip hover ────────────────────────────────────────────────────────────
  const handleChipEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    import("gsap").then(({ gsap }) => {
      gsap.to(e.currentTarget, {
        scale: 1.12, boxShadow: "0 0 18px rgba(0,245,255,0.5)",
        borderColor: "#00f5ff", color: "#00f5ff",
        duration: 0.22, ease: "power2.out",
      });
    });
  }, []);

  const handleChipLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    import("gsap").then(({ gsap }) => {
      gsap.to(e.currentTarget, {
        scale: 1, boxShadow: "none",
        borderColor: "rgba(0,245,255,0.18)", color: "rgba(0,245,255,0.65)",
        duration: 0.22, ease: "power2.out",
      });
    });
  }, []);

  const handleChipClick = useCallback((topic: string) => {
    if (onTopicSelect) {
      onTopicSelect(topic);
    } else {
      onStart();
    }
  }, [onTopicSelect, onStart]);

  // ─── Demo modal ────────────────────────────────────────────────────────────
  const openModal = useCallback(() => {
    setShowModal(true);
    setDemoLineA("");
    setDemoLineB("");
    setActiveSpeaker(null);
    setDemoStep(0);
  }, []);

  useEffect(() => {
    if (!showModal) return;
    import("gsap").then(({ gsap }) => {
      gsap.fromTo(".lh-modal",
        { opacity: 0, scale: 0.82, y: 50 },
        { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: "back.out(1.6)" });
    });
  }, [showModal]);

  useEffect(() => {
    if (demoStep < 0 || demoStep >= DEMO_SCRIPT.length) return;
    const line = DEMO_SCRIPT[demoStep];
    setActiveSpeaker(line.agent);

    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (line.agent === "A") setDemoLineA(line.text.slice(0, i));
      else setDemoLineB(line.text.slice(0, i));
      if (i >= line.text.length) {
        clearInterval(interval);
        const timer = setTimeout(() => setDemoStep((s) => s + 1), 1400);
        return () => clearTimeout(timer);
      }
    }, 20);

    return () => clearInterval(interval);
  }, [demoStep]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setDemoStep(-1);
    setActiveSpeaker(null);
  }, []);

  // ─── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="lh-root">
      {/* Portal opening overlay */}
      <div className="lh-portal-overlay" aria-hidden="true">
        <div className="lh-portal-ring lh-portal-ring--1" />
        <div className="lh-portal-ring lh-portal-ring--2" />
        <div className="lh-portal-ring lh-portal-ring--3" />
      </div>

      {/* Neural constellation */}
      <canvas ref={canvasRef} className="lh-canvas" aria-hidden="true" />

      {/* Ambient depth orbs */}
      <div className="lh-ambient" aria-hidden="true">
        <div className="lh-orb lh-orb--cyan" />
        <div className="lh-orb lh-orb--magenta" />
        <div className="lh-orb lh-orb--gold" />
      </div>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="lh-hero">
        <h1 ref={titleRef} className="lh-title">
          <span className="lh-title-word">AI Panel</span>{" "}
          <span className="lh-title-word">Discussions.</span>{" "}
          <br className="lh-title-br" />
          <span className="lh-title-gradient lh-title-word">Instantly</span>{" "}
          <span className="lh-title-gradient lh-title-word">On Any Topic.</span>
        </h1>

        <p className="lh-sub">
          Drop any topic and get a live, voice-first AI panel — debating, teaching, podcasting, or arguing — 
          with agents that fact-check claims in real time using web search tools.
        </p>

        {/* Voice-wave underglow */}
        <div className="lh-sub-wave" aria-hidden="true">
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className="lh-sw-bar" />
          ))}
        </div>

        {/* CTA */}
        <div className="lh-cta-wrap">
          <button
            ref={ctaBtnRef}
            className="lh-cta"
            type="button"
            onMouseMove={handleCtaMouseMove}
            onMouseLeave={handleCtaMouseLeave}
            onMouseEnter={handleCtaHover}
            onClick={handleCtaClick}
          >
            <span className="lh-cta-text">Start a Debate</span>
            <span className="lh-cta-arrow">→</span>
            <span className="lh-energy-ring lh-energy-ring--1" />
            <span className="lh-energy-ring lh-energy-ring--2" />
            <span className="lh-energy-ring lh-energy-ring--3" />
          </button>

          <button className="lh-preview-btn" type="button" onClick={openModal}>
            ▷ Watch a Live Demo
          </button>
        </div>
      </section>

      {/* ── FLOATING TOPIC CHIPS ─────────────────────────────── */}
      <div className="lh-chips-wrap" aria-label="Example debate topics">
        {TOPICS.map((topic) => (
          <button
            key={topic}
            className="lh-chip"
            type="button"
            onMouseEnter={handleChipEnter}
            onMouseLeave={handleChipLeave}
            onClick={() => handleChipClick(topic)}
          >
            {topic}
          </button>
        ))}
      </div>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="lh-how">
        <h2 className="lh-how-heading">
          <span className="lh-how-eyebrow">THE PROCESS</span>
          How It Works
        </h2>

        <div className="lh-connector-line" aria-hidden="true" />

        <div className="lh-how-grid">
          {HOW_IT_WORKS.map((step) => (
            <div key={step.title} className="lh-how-card">
              <div className="lh-how-number">{step.number}</div>
              <div className="lh-how-icon-wrap">
                <span className="lh-how-icon">{step.icon}</span>
                <div className="lh-how-wave-wrap" aria-hidden="true">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <span key={j} className="lh-hw-bar" />
                  ))}
                </div>
              </div>
              <h3 className="lh-how-title">{step.title}</h3>
              <p className="lh-how-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIVE DEBATE MODAL ────────────────────────────────── */}
      {showModal && (
        <div className="lh-modal-overlay" onClick={closeModal} role="dialog" aria-modal="true" aria-label="Live debate preview">
          <div className="lh-modal" onClick={(e) => e.stopPropagation()}>
            <button className="lh-modal-close" type="button" onClick={closeModal} aria-label="Close">✕</button>
            <p className="lh-modal-topic-label">LIVE DEBATE PREVIEW</p>
            <h3 className="lh-modal-title">Universal Basic Income</h3>

            <div className="lh-modal-stage">
              {/* Agent A */}
              <div className={`lh-modal-agent lh-modal-agent--a${activeSpeaker === "A" ? " lh-modal-agent--active" : ""}`}>
                <div className="lh-modal-avatar lh-modal-avatar--a">
                  <span>A</span>
                  {activeSpeaker === "A" && (
                    <>
                      <div className="lh-avatar-ring lh-avatar-ring--1" />
                      <div className="lh-avatar-ring lh-avatar-ring--2" />
                    </>
                  )}
                </div>
                <div className="lh-modal-label">AGENT ALPHA</div>
                {activeSpeaker === "A" && (
                  <div className="lh-modal-waveform" aria-hidden="true">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} className="lh-mw-bar lh-mw-bar--a" style={{ animationDelay: `${i * 0.045}s` }} />
                    ))}
                  </div>
                )}
                <p className="lh-modal-text">
                  {demoLineA}
                  {activeSpeaker === "A" && <span className="lh-cursor" />}
                </p>
              </div>

              {/* VS */}
              <div className="lh-modal-vs" aria-hidden="true">
                <div className="lh-vs-line" />
                <span>VS</span>
                <div className="lh-vs-line" />
              </div>

              {/* Agent B */}
              <div className={`lh-modal-agent lh-modal-agent--b${activeSpeaker === "B" ? " lh-modal-agent--active" : ""}`}>
                <div className="lh-modal-avatar lh-modal-avatar--b">
                  <span>B</span>
                  {activeSpeaker === "B" && (
                    <>
                      <div className="lh-avatar-ring lh-avatar-ring--1" />
                      <div className="lh-avatar-ring lh-avatar-ring--2" />
                    </>
                  )}
                </div>
                <div className="lh-modal-label">AGENT BETA</div>
                {activeSpeaker === "B" && (
                  <div className="lh-modal-waveform" aria-hidden="true">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} className="lh-mw-bar lh-mw-bar--b" style={{ animationDelay: `${i * 0.045}s` }} />
                    ))}
                  </div>
                )}
                <p className="lh-modal-text">
                  {demoLineB}
                  {activeSpeaker === "B" && <span className="lh-cursor" />}
                </p>
              </div>
            </div>

            <button
              className="lh-modal-cta"
              type="button"
              onClick={() => { closeModal(); setTimeout(onStart, 100); }}
            >
              Start Your Own Debate →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

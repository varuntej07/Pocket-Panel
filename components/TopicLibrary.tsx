"use client";

import { useEffect } from "react";

interface TopicLibraryProps {
  onSelect: (topic: string) => void;
}

const TOPICS = [
  "Should AI systems be allowed to make binding legal decisions?",
  "Universal basic income: safety net or economic trap?",
  "Nuclear energy is the only realistic path to net zero",
  "Is remote work permanently degrading collaboration and culture?",
  "Should social media platforms be regulated as public utilities?",
  "Consciousness: emergent property of matter or something irreducible?",
  "Can gene editing eliminate inherited disease within a generation?",
  "Cryptocurrency — legitimate currency or institutionalized speculation?",
  "Space colonization: humanity's insurance policy or a billionaire fantasy?",
  "Free will vs determinism — does neuroscience settle the debate?",
  "Should billionaires exist in a functioning democracy?",
  "Open-source AI: accelerating progress or accelerating risk?",
  // Tool-calling topics — benefit from live data lookup
  "What do the latest AI chip export restrictions mean for global tech power?",
  "How are central banks currently responding to persistent inflation?",
];

export function TopicLibrary({ onSelect }: TopicLibraryProps) {
  useEffect(() => {
    import("gsap").then(({ gsap }) => {
      gsap.from(".topicPill", {
        opacity: 0,
        y: 16,
        stagger: 0.04,
        duration: 0.4,
        ease: "power2.out",
        clearProps: "all",
      });
    });
  }, []);

  return (
    <div className="topicLibrary">
      <div className="topicPills">
        {TOPICS.map((topic) => (
          <button
            key={topic}
            type="button"
            className="topicPill"
            onClick={() => onSelect(topic)}
          >
            {topic}
          </button>
        ))}
      </div>
    </div>
  );
}

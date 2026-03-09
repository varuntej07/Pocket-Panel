"use client";

import { useEffect } from "react";

interface TopicLibraryProps {
  onSelect: (topic: string) => void;
}

const CATEGORIES: { label: string; color: string; topics: string[] }[] = [
  {
    label: "Debate",
    color: "#4ade80",
    topics: ["AI should replace teachers", "Democracy vs meritocracy", "Capital punishment effectiveness"],
  },
  {
    label: "Argument",
    color: "#f87171",
    topics: ["Remote work kills creativity", "Social media causes depression", "Crypto is a scam"],
  },
  {
    label: "Teaching",
    color: "#60a5fa",
    topics: ["How does quantum computing work?", "Explain blockchain simply", "What is universal basic income?"],
  },
  {
    label: "Podcast",
    color: "#fbbf24",
    topics: ["The future of electric vehicles", "Space tourism — opportunity or folly?", "Can gene editing cure disease?"],
  },
  {
    label: "Philosophy",
    color: "#c084fc",
    topics: ["Free will vs determinism", "Is morality objective?", "The nature of consciousness"],
  },
];

export function TopicLibrary({ onSelect }: TopicLibraryProps) {
  useEffect(() => {
    import("gsap").then(({ gsap }) => {
      gsap.from(".topicPill", {
        opacity: 0,
        y: 20,
        stagger: 0.06,
        duration: 0.45,
        ease: "power2.out",
        clearProps: "all",
      });
    });
  }, []);

  return (
    <div className="topicLibrary">
      <p className="topicLibraryHeading">Or pick a starter topic</p>
      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="topicCategory">
          <span className="topicCategoryLabel" style={{ color: cat.color }}>
            {cat.label}
          </span>
          <div className="topicPills">
            {cat.topics.map((topic) => (
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
      ))}
    </div>
  );
}

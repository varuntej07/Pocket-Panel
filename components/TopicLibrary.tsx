"use client";

import { useEffect } from "react";

interface TopicLibraryProps {
  onSelect: (topic: string) => void;
}

const TOPICS = [
  // Everyday life & work
  "Is a 4-day work week actually more productive?",
  "Should tipping culture be abolished in restaurants?",
  "Is college still worth now?", "Should phones be banned in schools?",
  "WFH vs office - which actually wins?", "Throughput vs creativity: which matters?",
  "Are landlords contributing to the housing crisis?",
  "Is hustle culture doing more harm than good?",

  // Tech & AI
  "Will AI take more jobs than it creates?", "AI vs human creativity",
  "Should social media have an age minimum of 16?", "Model Training vs Inference",
  "Is TikTok a national security threat or a moral panic?",
  "Should self-driving cars be allowed on public roads today?",
  "Do we rely too much on smartphones?",

  // Money & economy
  "Is cryptocurrency a legitimate investment or glorified gambling?",
  "Should the minimum wage be tied to inflation automatically?",
  "Is universal basic income a safety net or a poverty trap?",
  "Are subscription services quietly bleeding consumers dry?",

  // Health & lifestyle
  "Should fast food companies be taxed like tobacco?",
  "Is veganism the most ethical diet or an oversimplification?",
  "Should healthcare be completely free at the point of use?",

  // Society & politics
  "Should voting be mandatory?",
  "Is cancel culture a necessary accountability tool or mob justice?",
  "Should billionaires exist in a functioning democracy?",
  "Should the death penalty be abolished everywhere?",

  // Science & future
  "Should we be colonizing Mars or fixing Earth first?",
  "Is nuclear energy the safest path to clean power?",
  "Should gene editing to prevent inherited disease be legal?",
  "Are we heading toward a surveillance state and is that inevitable?",
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

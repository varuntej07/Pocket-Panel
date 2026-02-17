"use client";

import type { ChangeEvent } from "react";

interface PromptFormProps {
  prompt: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function PromptForm({ prompt, disabled, onChange, onSubmit }: PromptFormProps) {
  return (
    <section className="panel hero">
      <h1>PocketPanel</h1>
      <p>Type a topic, pick a mode, and listen as two AI voices debate it in real time.</p>
      <textarea
        className="promptInput"
        placeholder="Example: Should AI tutors replace traditional homework?"
        value={prompt}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        disabled={disabled}
        rows={4}
      />
      <button type="button" className="primaryButton" onClick={onSubmit} disabled={disabled || prompt.trim().length < 4}>
        Suggest Modes
      </button>
    </section>
  );
}

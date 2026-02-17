export const splitTextForSpeech = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return [trimmed];
  }

  const segments: string[] = [];
  let buffer = "";

  for (const part of parts) {
    const next = buffer ? `${buffer} ${part}` : part;
    if (next.length <= 220) {
      buffer = next;
      continue;
    }
    if (buffer) {
      segments.push(buffer);
    }
    buffer = part;
  }

  if (buffer) {
    segments.push(buffer);
  }

  return segments;
};

export const chunkBuffer = (bytes: Uint8Array, chunkSize: number): Uint8Array[] => {
  if (chunkSize <= 0 || bytes.length === 0) {
    return [bytes];
  }

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return chunks;
};

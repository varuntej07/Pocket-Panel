import { z } from "zod";

export const INTENT_VALUES = ["debate", "argument", "teaching", "podcast", "none"] as const;

export const classifyIntentToolName = "classify_intent";

export const ClassifyIntentOutputSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  suggestedModes: z.array(z.string().min(1)).max(35).default([])
});

export const ClassifyIntentRequestSchema = z.object({
  prompt: z.string().trim().min(4).max(2000)
});

export const StartSessionRequestSchema = z.object({
  prompt: z.string().trim().min(4).max(2000),
  modeId: z.string().trim().min(1)
});

export const classifyIntentToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: INTENT_VALUES
    },
    suggestedModes: {
      type: "array",
      items: {
        type: "string"
      },
      minItems: 0,
      maxItems: 35
    }
  },
  required: ["intent", "suggestedModes"]
} as const;

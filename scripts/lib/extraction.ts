// The extraction brief and candidate shape, shared by the extractor and the
// corpus build.
import path from "node:path";
import { z } from "zod";
import { CLAIM_KINDS, MODALITIES } from "../../src/policy.ts";
import { PRIVATE_DIR } from "./private-store.ts";

export const EXTRACT_PROMPT = { version: "extract-1", file: "research/prompts/extract-1.md" };
export const EXTRACT_DIR = path.join(PRIVATE_DIR, "extractions");
const Period = z.object({ start: z.string().nullable(), end: z.string().nullable() }).strict();
export const Candidate = z.object({
  quote: z.string().min(1), excerpt: z.string().min(1), locator: z.string().min(1), endorsement: z.enum(["endorsed", "quoted_other"]),
  kind: z.enum(CLAIM_KINDS), modality: z.enum(MODALITIES), graded_confidence: z.enum(["high", "medium", "low"]).nullable(),
  polarity: z.enum(["affirm", "deny"]), predicate: z.string().min(1), target: z.string().min(1), target_version: z.string().nullable(),
  threshold: z.string().nullable(), metric: z.string().nullable(), conditions: z.array(z.string()), horizon_text: z.string().nullable(),
  horizon_end: z.string().nullable(), observation_period: Period.nullable(), normalized_proposition: z.string().min(1),
  topic_tags: z.array(z.string()), concerns_providers: z.array(z.enum(["openai", "anthropic"])),
}).strict();
export type Candidate = z.infer<typeof Candidate>;

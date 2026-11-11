// Companies a claim is about, from a reviewed alias table. Deterministic: the
// claim's free-text target and its normalised proposition are matched against
// each company's names, products, and leaders. A claim can name several
// companies, or none ("unmapped"). The raw target is never changed. Add an
// alias here, not in the data.
import type { PublicClaim } from "./manifest.ts";

export type Entity = { id: string; name: string; aliases: RegExp };

export const ENTITIES: Entity[] = [
  { id: "openai", name: "OpenAI", aliases: /\b(open ?ai|chat ?gpt|gpt[- ]?[0-9o]|gpt[- ]?4\.5|gpt-?5|sora|dall-?e|sam altman|altman|o1|o3|o4|codex|stargate)\b/i },
  { id: "anthropic", name: "Anthropic", aliases: /\b(anthropic|claude|dario amodei|amodei)\b/i },
  { id: "google", name: "Google", aliases: /\b(google|deepmind|gemini|bard|imagen|alpha ?(go|fold|geometry2?|proof|zero|code|evolve)|lamda|palm|waymo|sundar pichai|demis hassabis)\b/i },
  { id: "microsoft", name: "Microsoft", aliases: /\b(microsoft|bing|copilot|satya nadella|nadella)\b/i },
  { id: "meta", name: "Meta", aliases: /\b(meta(?!-)( ai)?|facebook|llama|cicero|galactica|zuckerberg|yann lecun|lecun)\b/i },
  { id: "nvidia", name: "Nvidia", aliases: /\b(nvidia|jensen huang|jensen)\b/i },
  { id: "xai", name: "xAI", aliases: /\b(xai|grok|elon musk|musk)\b/i },
  { id: "tesla", name: "Tesla", aliases: /\b(tesla|optimus|full self-driving|fsd)\b/i },
  { id: "apple", name: "Apple", aliases: /\b(apple|siri)\b/i },
  { id: "amazon", name: "Amazon", aliases: /\b(amazon|aws|alexa)\b/i },
  { id: "deepseek", name: "DeepSeek", aliases: /\b(deepseek)\b/i },
  { id: "coreweave", name: "CoreWeave", aliases: /\b(coreweave)\b/i },
  { id: "oracle", name: "Oracle", aliases: /\b(oracle)\b/i },
  { id: "softbank", name: "SoftBank", aliases: /\b(softbank|masayoshi son)\b/i },
  { id: "perplexity", name: "Perplexity", aliases: /\b(perplexity)\b/i },
  { id: "mistral", name: "Mistral", aliases: /\b(mistral)\b/i },
  { id: "cursor", name: "Cursor", aliases: /\b(cursor|anysphere)\b/i },
];
export const UNMAPPED = "none";

export function entitiesOf(c: Pick<PublicClaim, "target" | "normalized_proposition">): string[] {
  const text = `${c.target ?? ""} ${c.normalized_proposition}`;
  return ENTITIES.filter((e) => e.aliases.test(text)).map((e) => e.id);
}
export const entityName = (id: string): string => ENTITIES.find((e) => e.id === id)?.name ?? "No company named";

export const SALES_CONSULTANT_NAMES = [
  "AJ Smith",
  "Eli R",
  "Alexander Cristerna",
  "Moises Covarrubias",
  "Mike Conarton",
  "Jarret Beck",
  "Ross P",
] as const;

export type SalesConsultantName =
  (typeof SALES_CONSULTANT_NAMES)[number];

const CONSULTANT_ALIASES: Array<{
  name: SalesConsultantName;
  pattern: RegExp;
}> = [
  { name: "AJ Smith", pattern: /\b(?:aj|a\.?j\.?|aj\s+smith)\b/i },
  { name: "Eli R", pattern: /\b(?:eli|eli\s+r)\b/i },
  {
    name: "Alexander Cristerna",
    pattern: /\b(?:alex|alexander|alexander\s+cristerna)\b/i,
  },
  {
    name: "Moises Covarrubias",
    pattern: /\b(?:moises|moises\s+covarrubias)\b/i,
  },
  {
    name: "Mike Conarton",
    pattern: /\b(?:mike|mike\s+conarton)\b/i,
  },
  {
    name: "Jarret Beck",
    pattern: /\b(?:jarret|jarrett|jarret\s+beck|jarrett\s+beck)\b/i,
  },
  { name: "Ross P", pattern: /\b(?:ross|ross\s+p)\b/i },
];

const EXPLICIT_CONSULTANT_REQUEST =
  /\b(?:what\s+about|how\s+about|can\s+we\s+(?:use|try|send)|could\s+we\s+(?:use|try|send)|please\s+use|use|try|check|search\s+for|look\s+for|with)\b/i;

export function consultantRequestedInText(
  value: string
): SalesConsultantName | null {
  const text = String(value || "").trim();
  if (!text || !EXPLICIT_CONSULTANT_REQUEST.test(text)) return null;

  return (
    CONSULTANT_ALIASES.find(({ pattern }) => pattern.test(text))?.name || null
  );
}

export function requestedConsultantFromConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): SalesConsultantName | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user") continue;

    const requested = consultantRequestedInText(message.content);
    if (requested) return requested;

    // A new location starts a fresh automatic-consultant search unless that
    // same message explicitly names a consultant.
    if (/\b\d{5}(?:-\d{4})?\b/.test(message.content)) return null;
  }

  return null;
}

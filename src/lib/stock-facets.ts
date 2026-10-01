export type StockFacet = {
  collection: string;
  variant: string;
};

export type StockCollection = {
  name: string;
  variants: string[];
  count: number;
};

function labelWord(word: string): string {
  if (/^[0-9]/.test(word)) return word;
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** First word is the collection. A single word such as "Canvas" stays that collection. */
export function stockFacet(name: string | null | undefined): StockFacet {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return { collection: "Other", variant: "Standard" };
  const collection = labelWord(words[0]);
  if (words.length === 1) return { collection, variant: "Standard" };
  return {
    collection,
    variant: words.slice(1).map(labelWord).join(" "),
  };
}

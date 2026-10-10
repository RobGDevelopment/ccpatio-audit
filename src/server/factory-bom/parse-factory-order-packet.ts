export type ParsedOrderLine = {
  rawLine: string;
  family: string;
  widthInches: string;
  depthInches: string;
  quantity: number;
  configuration: string;
};

export function parseFactoryOrderLine(line: string): ParsedOrderLine {
  const originalLine = line;
  let work = line.trim().toUpperCase();

  let configuration = "";
  const parenMatch = work.match(/\((.*?)\)/);
  if (parenMatch) {
    configuration = parenMatch[1].trim();
    work = work.replace(parenMatch[0], "").trim();
  }

  // Normalize inch marks
  work = work.replace(/''/g, "");
  work = work.replace(/"/g, "");

  // Normalize dimension separators
  work = work.replace(/(?:\s*(?:x|X|×|\*|A-)\s*)/g, " X ");

  let quantity = 1;
  const qtyMatch = work.match(/^(\d+)\s+(.+)$/);
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
    work = qtyMatch[2].trim();
  }

  const dimMatch = work.match(/(.*?)\s+(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)$/);
  let family = work;
  let widthInches = "";
  let depthInches = "";

  if (dimMatch) {
    family = dimMatch[1].trim();
    widthInches = dimMatch[2];
    depthInches = dimMatch[3];
  } else {
    // try to match just one dimension?
    const singleDimMatch = work.match(/(.*?)\s+(\d+(?:\.\d+)?)$/);
    if (singleDimMatch) {
      family = singleDimMatch[1].trim();
      widthInches = singleDimMatch[2];
    }
  }
  
  return {
    rawLine: originalLine,
    family: family.replace(/[^A-Z0-9 -]/g, "").trim(),
    widthInches,
    depthInches,
    quantity,
    configuration,
  };
}

import { describe, expect, it } from "vitest";
import { mergeResearchPaste } from "../scripts/lib/parse-handoff-research-paste";

describe("mergeResearchPaste", () => {
  it("merges multiple json fences into one object", () => {
    const md = `
### A
\`\`\`json
{"fabric_grades":[{"internal_id":"FAB-CAN-BLA","pricing_grade":"A"}]}
\`\`\`
### C
\`\`\`json
{"upcharges":{"fabric_grades":{"A":0,"B":150}}}
\`\`\`
`;
    const merged = mergeResearchPaste(md);
    expect(merged.fabric_grades).toHaveLength(1);
    expect(merged.upcharges).toEqual({ fabric_grades: { A: 0, B: 150 } });
  });
});

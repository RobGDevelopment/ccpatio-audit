export function mapDisplayToFreight(display: { length?: string | null, depth?: string | null, height?: string | null, weight?: string | null }) {
  return {
    lengthIn: display.length || "",
    widthIn: display.depth || "", // Note: display depth maps to freight width
    heightIn: display.height || "",
    weightLb: display.weight || "",
  };
}

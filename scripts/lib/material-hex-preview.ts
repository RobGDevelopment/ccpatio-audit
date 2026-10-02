/**
 * Hex / Preview values for Tab 02 WEB FABRICS & FINISHES.
 * Sourced from handoff research (Sunbrella fabrics + powder coats).
 * Dekton SKUs intentionally omit hex when Cosentino does not publish one.
 */
export const MATERIAL_HEX_PREVIEW: Readonly<Record<string, string>> = {
  "FAB-CAB-CLA": "#2C2D30",
  "FAB-CAN-BLA": "#1A1A1A",
  "FAB-CAN-NAV": "#1B2836",
  "FAB-CAN-WHI": "#F4F4F0",
  "FAB-CASS-CORA": "#D46A55",
  "FAB-CASS-SLAT": "#636B73",
  "FAB-CHA-SIL": "#D8D5CD",
  "FAB-CRU-ASH": "#A0A2A3",
  "FAB-CRU-SNO": "#EFEFEA",
  "FAB-DUM-STU": "#C8BFB2",
  "FAB-EST-MAR": "#284155",
  "FAB-EST-ONY": "#222224",
  "FAB-HER-PAP": "#D6D0C4",
  "FAB-KIN-SIL": "#DCD7D0",
  "FAB-LEA-STRCLO": "#E3E5E3",
  "FAB-LIN-PAR": "#D5CDBE",
  "FAB-LIN-SPA": "#98B8B5",
  "FAB-MET-CLO": "#DFDFD9",
  "FAB-MET-FOG": "#9DA1A5",
  "FAB-MET-LAG": "#4A6B74",
  "FAB-MET-SAN": "#C2B69D",
  "FAB-MET-SNO": "#F0EFEA",
  "FAB-MID-STO": "#8D8982",
  "FAB-MOU-SNO": "#E8E7E2",
  "FAB-POS-SAP": "#253B56",
  "FAB-PRE-FAW": "#BFA993",
  "FAB-RIT-CHA": "#7A919E",
  "FAB-RIT-NEC": "#D48668",
  "FAB-RIT-ROS": "#5E6B56",
  "FAB-RUE-COS": "#5C7A87",
  "FAB-SHE-LIN": "#D8D1C5",
  "FAB-SHE-SUR": "#668F9E",
  "FAB-SHE-WHI": "#EDECE6",
  "FAB-SOL-SEA": "#A6ABB0",
  "FAB-UND-STO": "#474D52",
  "FAB-SOL-LIN": "#D5CEC2",
  "PWD-BLACK": "#1A1A1A",
  "PWD-BONE": "#E3DAC9",
  "PWD-FANUC-GRAY": "#6C7059",
  "PWD-LITE-BEIGE": "#D8C8B8",
  "PWD-OIL-RUB-BRONZE": "#3B312A",
  "PWD-WILD-RICE": "#594E42",
};

export function hexPreviewForInternalId(internalId: string): string {
  const key = internalId.trim().toUpperCase();
  if (!key) return "";
  return MATERIAL_HEX_PREVIEW[key] ?? MATERIAL_HEX_PREVIEW[internalId.trim()] ?? "";
}

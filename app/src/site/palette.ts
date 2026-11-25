// The colours a person marks their channels with (flows/site.md). A set of its own, apart from
// ohm's interface colours: deep and a little muted, so eight of them sit together on white paper
// and none shouts. It starts from the person's navy and is built out around it: two cool
// neighbours (petrol, forest), two warm opposites (burgundy, clay), one light warm accent (ochre),
// and two near-neutrals (plum, ink). A dot wears one of them either filled or as an edge only.
export const PALETTE = [
  { key: "navy", name: "Navy", hex: "#0409A6" },
  { key: "petrol", name: "Petrol", hex: "#0F5A66" },
  { key: "forest", name: "Forest", hex: "#1E4D3B" },
  { key: "ochre", name: "Ochre", hex: "#B5832A" },
  { key: "clay", name: "Clay", hex: "#A4502F" },
  { key: "burgundy", name: "Burgundy", hex: "#6E1B2D" },
  { key: "plum", name: "Plum", hex: "#4B2A4F" },
  { key: "ink", name: "Ink", hex: "#17171C" },
] as const

/** A dot as it is kept: `burgundy` filled, `burgundy:edge` as an edge only, or empty for none. */
export function readDot(value: string): { hex: string; edge: boolean; name: string } | null {
  const [key, how] = value.split(":")
  const colour = PALETTE.find(c => c.key === key)
  return colour ? { hex: colour.hex, edge: how === "edge", name: colour.name } : null
}

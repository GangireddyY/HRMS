/**
 * Cover banner for person cards and profile headers. Built from theme variables (the brand palette, status colours and
 * the surface colour), so it follows the chosen colour palette and stays soft in light and dark modes. Each seed (an
 * email or id) gets its own accent and angle, so the same person always gets the same banner.
 */
const ACCENTS = ['var(--brand-500)', 'var(--status-info)', 'var(--status-special)', 'var(--status-away)', 'var(--status-success)', 'var(--brand-300)'];

export function profileCover(seed: string): { backgroundImage: string } {
  const hash = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const accent = ACCENTS[hash % ACCENTS.length]!;
  const angle = 115 + (hash % 5) * 12;
  const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, var(--app-surface))`;
  return {
    backgroundImage: [
      `radial-gradient(120% 160% at 100% 0%, color-mix(in oklab, ${accent} 26%, transparent), transparent 60%)`,
      `linear-gradient(${angle}deg, ${tint('var(--brand-500)', 24)}, ${tint(accent, 14)})`,
    ].join(', '),
  };
}

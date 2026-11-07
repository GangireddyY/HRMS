/** The level that counts: the verified one when there is one, else the employee's own rating. */
export const effectiveLevel = (s: { level: number | null; verifiedLevel: number | null } | undefined | null): number => s?.verifiedLevel ?? s?.level ?? 0;

export interface Requirement {
  skillId: string;
  requiredLevel: number;
}

export interface Gap {
  skillId: string;
  required: number;
  current: number;
  gap: number;
}

/** Required skills the employee is below, biggest gap first. */
export function skillGaps(requirements: Requirement[], levels: Map<string, number>): Gap[] {
  return requirements
    .map((r) => {
      const current = levels.get(r.skillId) ?? 0;
      return { skillId: r.skillId, required: r.requiredLevel, current, gap: Math.max(0, r.requiredLevel - current) };
    })
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.skillId.localeCompare(b.skillId));
}

/** Share of the requirements met (0–100); 100 when the role needs nothing. */
export function readiness(requirements: Requirement[], levels: Map<string, number>): number {
  if (!requirements.length) return 100;
  const met = requirements.filter((r) => (levels.get(r.skillId) ?? 0) >= r.requiredLevel).length;
  return Math.round((met / requirements.length) * 100);
}

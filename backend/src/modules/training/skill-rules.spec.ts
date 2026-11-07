import { effectiveLevel, readiness, skillGaps } from './skill-rules';

describe('skill rules', () => {
  it('uses the verified level when there is one', () => {
    expect(effectiveLevel({ level: 4, verifiedLevel: 2 })).toBe(2);
    expect(effectiveLevel({ level: 3, verifiedLevel: null })).toBe(3);
    expect(effectiveLevel(undefined)).toBe(0);
  });

  it('finds gaps against the role and how ready someone is', () => {
    const requirements = [
      { skillId: 'ts', requiredLevel: 4 },
      { skillId: 'sql', requiredLevel: 3 },
      { skillId: 'talk', requiredLevel: 2 },
    ];
    const levels = new Map([
      ['ts', 2],
      ['sql', 3],
    ]);
    expect(skillGaps(requirements, levels)).toEqual([
      { skillId: 'talk', required: 2, current: 0, gap: 2 },
      { skillId: 'ts', required: 4, current: 2, gap: 2 },
    ]);
    expect(readiness(requirements, levels)).toBe(33);
    expect(readiness([], levels)).toBe(100);
  });
});

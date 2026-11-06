import { certificateExpiry, certificationState, missingRequirements, scoreAttempt } from './training-rules';

describe('training rules', () => {
  const questions = [
    { id: 'a', correctIndex: 1, optionCount: 4 },
    { id: 'b', correctIndex: 0, optionCount: 3 },
    { id: 'c', correctIndex: 2, optionCount: 3 },
  ];

  it('scores assessments as a whole percentage against the pass mark', () => {
    expect(scoreAttempt(questions, { a: 1, b: 0, c: 2 }, 70)).toEqual({ correct: 3, total: 3, score: 100, passed: true });
    expect(scoreAttempt(questions, { a: 1, b: 0, c: 0 }, 70)).toEqual({ correct: 2, total: 3, score: 67, passed: false });
    expect(scoreAttempt(questions, { a: 1, b: 0 }, 60)).toMatchObject({ score: 67, passed: true });
    // Out-of-range or non-integer answers are wrong.
    expect(scoreAttempt(questions, { a: 9, b: 0.5 as number, c: 2 }, 50)).toMatchObject({ correct: 1, score: 33 });
    expect(scoreAttempt([], {}, 0)).toMatchObject({ score: 0, passed: false });
  });

  it('lists the requirements left before completion', () => {
    const base = { sessionBased: false, attended: false, hasAssessment: false, passed: false, markedDone: false };
    expect(missingRequirements(base)).toEqual(['Mark the course as done']);
    expect(missingRequirements({ ...base, markedDone: true })).toEqual([]);
    expect(missingRequirements({ ...base, sessionBased: true, hasAssessment: true })).toEqual(['Attend the session', 'Pass the assessment']);
    expect(missingRequirements({ ...base, sessionBased: true, hasAssessment: true, attended: true, passed: true })).toEqual([]);
    expect(missingRequirements({ ...base, hasAssessment: true, passed: true })).toEqual([]);
  });

  it('works out certificate expiry and its state', () => {
    expect(certificateExpiry('2026-03-15', 12)).toBe('2027-03-15');
    expect(certificateExpiry('2026-01-31', 1)).toBe('2026-02-28');
    expect(certificateExpiry('2026-11-30', 3)).toBe('2027-02-28');
    expect(certificateExpiry('2026-11-06', null)).toBeNull();
    expect(certificationState(null, '2026-11-06', 30)).toBe('NO_EXPIRY');
    expect(certificationState('2026-11-05', '2026-11-06', 30)).toBe('EXPIRED');
    expect(certificationState('2026-12-06', '2026-11-06', 30)).toBe('EXPIRING');
    expect(certificationState('2026-12-07', '2026-11-06', 30)).toBe('VALID');
  });
});

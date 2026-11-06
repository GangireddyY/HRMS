import { inAudience, npsScore, surveyResults, validateAnswers, type SurveyQuestion } from './engagement-rules';

const Q: SurveyQuestion[] = [
  { id: 'r', type: 'RATING', prompt: 'How satisfied are you?', options: [], required: true },
  { id: 'n', type: 'NPS', prompt: 'Recommend us?', options: [], required: true },
  { id: 'c', type: 'CHOICE', prompt: 'Best perk?', options: ['Food', 'Hybrid work', 'Learning budget'], required: false },
  { id: 't', type: 'TEXT', prompt: 'Anything else?', options: [], required: false },
];

describe('engagement rules', () => {
  it('matches audiences by department and location', () => {
    const e = { departmentId: 'd1', locationId: 'l1' };
    expect(inAudience({ departmentIds: null, locationIds: null }, e)).toBe(true);
    expect(inAudience({ departmentIds: [], locationIds: [] }, e)).toBe(true);
    expect(inAudience({ departmentIds: ['d1', 'd2'], locationIds: null }, e)).toBe(true);
    expect(inAudience({ departmentIds: ['d2'], locationIds: null }, e)).toBe(false);
    expect(inAudience({ departmentIds: ['d1'], locationIds: ['l2'] }, e)).toBe(false);
    expect(inAudience({ departmentIds: ['d1'], locationIds: null }, { departmentId: null, locationId: 'l1' })).toBe(false);
  });

  it('validates answers by question type', () => {
    expect(validateAnswers(Q, { r: 4, n: 10, c: 1, t: '  More plants  ' })).toEqual({ answers: { r: 4, n: 10, c: 1, t: 'More plants' }, problems: [] });
    expect(validateAnswers(Q, { r: 6, c: 3, t: 5 }).problems).toEqual(['Question 1: choose a valid answer', 'Question 2 needs an answer', 'Question 3: choose a valid answer', 'Question 4: enter text']);
    expect(validateAnswers(Q, { r: 3, n: 0, x: 'ignored' }).answers).toEqual({ r: 3, n: 0 });
    expect(validateAnswers(Q, { r: '4', n: 5 }).problems).toEqual(['Question 1: choose a valid answer']);
  });

  it('scores eNPS from promoters and detractors', () => {
    expect(npsScore([10, 9, 8, 7, 6, 0])).toEqual({ score: 0, promoters: 2, passives: 2, detractors: 2 });
    expect(npsScore([10, 10, 9, 3])).toEqual({ score: 50, promoters: 3, passives: 0, detractors: 1 });
    expect(npsScore([])).toEqual({ score: null, promoters: 0, passives: 0, detractors: 0 });
  });

  it('aggregates results per question', () => {
    const results = surveyResults(Q, [
      { r: 4, n: 10, c: 1, t: 'Great team' },
      { r: 5, n: 6, c: 1 },
      { r: 3, n: 9 },
    ]);
    expect(results[0]).toMatchObject({ answered: 3, average: 4, distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 } });
    expect(results[1]).toMatchObject({ answered: 3, average: 8.3, nps: { score: 33, promoters: 2, detractors: 1 } });
    expect(results[2]).toMatchObject({ answered: 2, distribution: { 0: 0, 1: 2, 2: 0 }, options: ['Food', 'Hybrid work', 'Learning budget'] });
    expect(results[3]).toMatchObject({ answered: 1, texts: ['Great team'] });
  });
});

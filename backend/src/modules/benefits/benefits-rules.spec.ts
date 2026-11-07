import {
  ageOn,
  carriedDependents,
  chargedInMonth,
  coverageStart,
  dependentProblems,
  enrollmentWindow,
  ineligibility,
  lifeEventProblem,
  renewalPeriod,
  type EligibilityPerson,
  type EligibilityRules,
} from './benefits-rules';

const plan = (over: Partial<EligibilityRules> = {}): EligibilityRules => ({
  employmentTypes: null,
  departmentIds: null,
  locationIds: null,
  gradeIds: null,
  waitingDays: 0,
  coverageStartsOn: '2026-04-01',
  coverageEndsOn: '2027-03-31',
  enrollmentOpensOn: '2026-03-15',
  enrollmentClosesOn: '2026-03-31',
  ...over,
});
const person = (over: Partial<EligibilityPerson> = {}): EligibilityPerson => ({
  status: 'ACTIVE',
  employmentType: 'FULL_TIME',
  departmentId: 'd1',
  locationId: 'l1',
  gradeId: null,
  dateOfJoining: '2024-01-08',
  ...over,
});

describe('benefits rules', () => {
  it('checks eligibility by employment type, department, location, grade and exit', () => {
    expect(ineligibility(plan(), person())).toBeNull();
    expect(ineligibility(plan({ employmentTypes: ['FULL_TIME'] }), person({ employmentType: 'INTERN' }))).toMatch(/employment type/);
    expect(ineligibility(plan({ departmentIds: ['d2'] }), person())).toMatch(/department/);
    expect(ineligibility(plan({ locationIds: ['l1'] }), person())).toBeNull();
    expect(ineligibility(plan({ gradeIds: ['g1'] }), person())).toMatch(/grade/);
    expect(ineligibility(plan(), person({ status: 'EXITED' }))).toMatch(/leaving/);
  });

  it('opens enrolment during the open window and for 30 days after a new joiner becomes eligible', () => {
    expect(enrollmentWindow(plan(), person(), '2026-03-20')).toEqual({ kind: 'OPEN_ENROLLMENT', closesOn: '2026-03-31' });
    expect(enrollmentWindow(plan(), person(), '2026-04-05')).toBeNull();
    const joiner = person({ dateOfJoining: '2026-06-01' });
    expect(enrollmentWindow(plan(), joiner, '2026-05-31')).toBeNull();
    expect(enrollmentWindow(plan(), joiner, '2026-07-01')).toEqual({ kind: 'NEW_JOINER', closesOn: '2026-07-01' });
    expect(enrollmentWindow(plan(), joiner, '2026-07-02')).toBeNull();
    // A waiting period moves the window.
    expect(enrollmentWindow(plan({ waitingDays: 90 }), joiner, '2026-07-01')).toBeNull();
    expect(enrollmentWindow(plan({ waitingDays: 90 }), joiner, '2026-09-15')).toEqual({ kind: 'NEW_JOINER', closesOn: '2026-09-29' });
    // Nothing after the policy period.
    expect(enrollmentWindow(plan(), person({ dateOfJoining: '2027-03-20' }), '2027-04-02')).toBeNull();
  });

  it('accepts life events from the last 30 days', () => {
    expect(lifeEventProblem('2026-06-01', '2026-07-01', plan())).toBeNull();
    expect(lifeEventProblem('2026-06-01', '2026-07-02', plan())).toMatch(/within 30 days/);
    expect(lifeEventProblem('2026-07-03', '2026-07-02', plan())).toMatch(/future/);
  });

  it('starts coverage at the policy start, eligibility, today or the life event', () => {
    expect(coverageStart(plan(), person(), 'OPEN_ENROLLMENT', '2026-03-20')).toBe('2026-04-01');
    expect(coverageStart(plan(), person(), 'OPEN_ENROLLMENT', '2026-05-10')).toBe('2026-05-10');
    expect(coverageStart(plan(), person({ dateOfJoining: '2026-06-01' }), 'NEW_JOINER', '2026-06-20')).toBe('2026-06-01');
    expect(coverageStart(plan({ waitingDays: 30 }), person({ dateOfJoining: '2026-06-01' }), 'HR', '2026-08-01')).toBe('2026-07-01');
    expect(coverageStart(plan(), person(), 'HR', '2026-08-01')).toBe('2026-04-01');
    expect(coverageStart(plan(), person(), 'LIFE_EVENT', '2026-08-01', '2026-07-20')).toBe('2026-07-20');
  });

  it('validates dependants against the option', () => {
    const family = { allowedRelations: ['SPOUSE', 'CHILD'] as const, maxDependents: 3 };
    const option = { ...family, allowedRelations: [...family.allowedRelations] };
    expect(ageOn('2001-04-02', '2026-04-01')).toBe(24);
    expect(ageOn('2001-04-01', '2026-04-01')).toBe(25);
    expect(
      dependentProblems(option, 25, [
        { name: 'Ravi', relationship: 'SPOUSE', dateOfBirth: null },
        { name: 'Anu', relationship: 'CHILD', dateOfBirth: '2018-05-01' },
      ], '2026-04-01'),
    ).toEqual([]);
    expect(dependentProblems(option, 25, [{ name: 'Mohan', relationship: 'FATHER', dateOfBirth: null }], '2026-04-01')).toEqual(["Mohan (father) isn't covered by this option"]);
    expect(dependentProblems(option, 25, [{ name: 'Kiran', relationship: 'CHILD', dateOfBirth: '2000-01-01' }], '2026-04-01')).toEqual(['Kiran is older than 25, the age limit for children']);
    expect(dependentProblems(option, 25, [{ name: 'Kiran', relationship: 'CHILD', dateOfBirth: null }], '2026-04-01')).toEqual(["Add Kiran's date of birth to cover them"]);
    expect(dependentProblems({ allowedRelations: [], maxDependents: 0 }, null, [{ name: 'Ravi', relationship: 'SPOUSE', dateOfBirth: null }], '2026-04-01')[0]).toBe('This option covers only the employee');
    expect(
      dependentProblems(option, null, [
        { name: 'A', relationship: 'SPOUSE', dateOfBirth: null },
        { name: 'B', relationship: 'SPOUSE', dateOfBirth: null },
      ], '2026-04-01'),
    ).toEqual(['Only one spouse can be covered']);
  });

  it('deducts the contribution for every month with at least one day of coverage', () => {
    const e = { status: 'ACTIVE' as const, effectiveFrom: '2026-06-20', effectiveTo: null };
    expect(chargedInMonth(e, '2026-05-01', '2026-05-31')).toBe(false);
    expect(chargedInMonth(e, '2026-06-01', '2026-06-30')).toBe(true);
    expect(chargedInMonth({ ...e, status: 'ENDED', effectiveTo: '2026-08-02' }, '2026-08-01', '2026-08-31')).toBe(true);
    expect(chargedInMonth({ ...e, status: 'ENDED', effectiveTo: '2026-08-02' }, '2026-09-01', '2026-09-30')).toBe(false);
    expect(chargedInMonth({ ...e, status: 'PENDING' }, '2026-06-01', '2026-06-30')).toBe(false);
  });

  it('works out the renewal period and which dependants carry over', () => {
    expect(renewalPeriod({ coverageStartsOn: '2026-04-01', coverageEndsOn: '2027-03-31' }, '2027-01-10')).toEqual({
      coverageStartsOn: '2027-04-01',
      coverageEndsOn: '2028-03-31',
      enrollmentOpensOn: '2027-03-02',
      enrollmentClosesOn: '2027-03-31',
    });
    // Renewed late: the window opens today; renewed after the new start: no window.
    expect(renewalPeriod({ coverageStartsOn: '2026-04-01', coverageEndsOn: '2027-03-31' }, '2027-03-20')).toMatchObject({ enrollmentOpensOn: '2027-03-20', enrollmentClosesOn: '2027-03-31' });
    expect(renewalPeriod({ coverageStartsOn: '2026-04-01', coverageEndsOn: '2027-03-31' }, '2027-04-05')).toMatchObject({ enrollmentOpensOn: null, enrollmentClosesOn: null });

    const deps = [
      { name: 'Ravi', relationship: 'SPOUSE' as const, dateOfBirth: '1990-02-01' },
      { name: 'Anya', relationship: 'CHILD' as const, dateOfBirth: '2001-06-01' },
      { name: 'Kabir', relationship: 'CHILD' as const, dateOfBirth: '2015-06-01' },
      { name: 'Mohan', relationship: 'FATHER' as const, dateOfBirth: '1960-01-01' },
    ];
    // Anya turns 25 before the new policy starts; parents aren't covered by this option.
    expect(carriedDependents({ allowedRelations: ['SPOUSE', 'CHILD'], maxDependents: 3 }, 24, deps, '2027-04-01').map((d) => d.name)).toEqual(['Ravi', 'Kabir']);
    expect(carriedDependents({ allowedRelations: ['SPOUSE', 'CHILD'], maxDependents: 1 }, 24, deps, '2027-04-01').map((d) => d.name)).toEqual(['Ravi']);
    expect(carriedDependents({ allowedRelations: [], maxDependents: 0 }, null, deps, '2027-04-01')).toEqual([]);
  });
});

import { carve, cycleLength, rotationSpans } from './roster-rules';

describe('roster rules', () => {
  const pattern = [
    { shiftId: 'M', days: 2 },
    { shiftId: null, days: 1 },
    { shiftId: 'N', days: 2 },
    { shiftId: null, days: 1 },
  ];

  it('lays a rotation over a range, merging consecutive days', () => {
    expect(cycleLength(pattern)).toBe(6);
    expect(rotationSpans(pattern, '2026-12-01', '2026-12-08')).toEqual([
      { shiftId: 'M', from: '2026-12-01', to: '2026-12-02' },
      { shiftId: null, from: '2026-12-03', to: '2026-12-03' },
      { shiftId: 'N', from: '2026-12-04', to: '2026-12-05' },
      { shiftId: null, from: '2026-12-06', to: '2026-12-06' },
      { shiftId: 'M', from: '2026-12-07', to: '2026-12-08' },
    ]);
    // Staggered team: starts two days into the cycle.
    expect(rotationSpans(pattern, '2026-12-01', '2026-12-03', 2)).toEqual([
      { shiftId: null, from: '2026-12-01', to: '2026-12-01' },
      { shiftId: 'N', from: '2026-12-02', to: '2026-12-03' },
    ]);
    expect(rotationSpans([{ shiftId: 'M', days: 7 }], '2026-12-30', '2027-01-02')).toEqual([{ shiftId: 'M', from: '2026-12-30', to: '2027-01-02' }]);
  });

  it('clears a range out of an existing roster entry', () => {
    const span = { from: '2026-12-01', to: '2026-12-31' };
    expect(carve(span, '2026-12-10', '2026-12-12')).toEqual([
      { from: '2026-12-01', to: '2026-12-09' },
      { from: '2026-12-13', to: '2026-12-31' },
    ]);
    expect(carve(span, '2026-11-20', '2026-12-05')).toEqual([{ from: '2026-12-06', to: '2026-12-31' }]);
    expect(carve(span, '2026-12-20', '2027-01-05')).toEqual([{ from: '2026-12-01', to: '2026-12-19' }]);
    expect(carve(span, '2026-11-01', '2027-01-31')).toEqual([]);
    expect(carve(span, '2027-01-01', '2027-01-02')).toEqual([span]);
  });
});

import { buildJournal, earningKey, tallyMastersXml, tallyName, tallyVoucherXml, withDefaults, type JournalPayslip } from './accounting-journal';

const slip = (department: string | null, basic: number, extra: Partial<JournalPayslip> = {}): JournalPayslip => ({
  department,
  earnings: [
    { code: 'BASIC', amount: basic },
    { code: 'HRA', amount: basic / 2 },
  ],
  deductions: [
    { code: 'PF', amount: 1800 },
    { code: 'PT', amount: 200 },
    { code: 'TDS', amount: 1000.5 },
  ],
  employerContributions: [
    { code: 'EPF', amount: 550 },
    { code: 'EPS', amount: 1250 },
  ],
  ...extra,
});

describe('payroll accounting journal', () => {
  it('balances: earnings and employer cost debited, deductions, employer dues and net pay credited', () => {
    const { lines } = buildJournal([slip('Sales', 20000), slip('Engineering', 30000)], withDefaults(null));
    const by = Object.fromEntries(lines.map((l) => [l.ledger, l]));
    expect(by['Salaries and Wages']).toMatchObject({ debit: 75000, credit: 0 });
    expect(by['Employer Contribution to PF']).toMatchObject({ debit: 3600 });
    // Employee PF 1,800 + employer 550 + 1,250 per person.
    expect(by['PF Payable']).toMatchObject({ credit: 7200 });
    expect(by['Professional Tax Payable']).toMatchObject({ credit: 400 });
    expect(by['TDS on Salary Payable']).toMatchObject({ credit: 2001 });
    expect(by['Salary Payable']).toMatchObject({ credit: 75000 - 2 * (1800 + 200 + 1000.5) });
    const debit = lines.reduce((n, l) => n + l.debit, 0);
    const credit = lines.reduce((n, l) => n + l.credit, 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    // Debits come first.
    const sides = lines.map((l) => (l.debit > 0 ? 'D' : 'C')).join('');
    expect(sides).toMatch(/^D+C+$/);
    expect(lines.every((l) => l.costCentres.length === 0)).toBe(true);
  });

  it('maps loans, benefits, adjustments, reimbursements and per-component ledgers', () => {
    const settings = withDefaults({ earningLedgers: { HRA: 'House Rent Allowance', ADJUSTMENT: 'Bonus and Incentives' }, ledgers: { SALARY_PAYABLE: 'Salaries Payable A/c' } });
    const { lines, groups } = buildJournal(
      [
        slip(null, 10000, {
          earnings: [
            { code: 'BASIC', amount: 10000 },
            { code: 'HRA', amount: 5000 },
            { code: 'ADJ_1a2b3c4d', amount: 2000 },
            { code: 'REIMBURSEMENT', amount: 750 },
          ],
          deductions: [
            { code: 'LOAN_9f8e7d6c', amount: 1000 },
            { code: 'BEN_11112222', amount: 300 },
            { code: 'ADJ_33334444', amount: 100 },
          ],
          employerContributions: [{ code: 'ESI_ER', amount: 400 }],
        }),
      ],
      settings,
    );
    const by = Object.fromEntries(lines.map((l) => [l.ledger, l]));
    expect(by['Salaries and Wages']!.debit).toBe(10000);
    expect(by['House Rent Allowance']!.debit).toBe(5000);
    expect(by['Bonus and Incentives']!.debit).toBe(2000);
    expect(by['Staff Reimbursements']!.debit).toBe(750);
    expect(by['Employer Contribution to ESI']!.debit).toBe(400);
    expect(by['ESI Payable']!.credit).toBe(400);
    expect(by['Loans and Advances to Employees']!.credit).toBe(1000);
    expect(by['Benefit Deductions Payable']!.credit).toBe(300);
    expect(by['Other Salary Deductions']!.credit).toBe(100);
    expect(by['Salaries Payable A/c']!.credit).toBe(17750 - 1400);
    expect(groups.get('Loans and Advances to Employees')).toBe('Loans & Advances (Asset)');
    expect(groups.get('House Rent Allowance')).toBe('Indirect Expenses');
    expect(earningKey('ENCASH_abcdef12')).toBe('ENCASHMENT');
  });

  it('splits expense lines by department cost centre when switched on', () => {
    const { lines } = buildJournal([slip('Sales', 20000), slip('Sales', 10000), slip(null, 30000)], withDefaults({ costCentres: true }));
    const salaries = lines.find((l) => l.ledger === 'Salaries and Wages')!;
    expect(salaries.costCentres).toEqual([
      { name: 'Sales', amount: 45000 },
      { name: 'Unassigned', amount: 45000 },
    ]);
    expect(lines.find((l) => l.ledger === 'PF Payable')!.costCentres).toEqual([]);
  });

  it('nets a ledger used on both sides and drops the cost-centre split it can no longer carry', () => {
    const settings = withDefaults({ costCentres: true, ledgers: { PF_EXPENSE: 'PF Account', PF_PAYABLE: 'PF Account' } });
    const { lines } = buildJournal([slip('Sales', 20000)], settings);
    const pf = lines.find((l) => l.ledger === 'PF Account')!;
    expect(pf).toMatchObject({ debit: 0, credit: 1800, costCentres: [] });
  });

  it('writes Tally import XML with debits negative and names escaped', () => {
    const settings = withDefaults({ tallyCompany: 'Acme & Co', costCentres: true });
    const { lines, groups } = buildJournal([slip('R&D', 20000)], settings);
    const voucher = tallyVoucherXml({ remoteId: 'hrms-payroll-1', date: '2026-10-31', narration: 'Salary for October 2026', lines }, settings);
    expect(voucher).toContain('<SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY>');
    expect(voucher).toContain('<VOUCHER REMOTEID="hrms-payroll-1" VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE>');
    expect(voucher).toContain('<LEDGERNAME>Salaries and Wages</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-30000.00</AMOUNT>');
    expect(voucher).toContain('<COSTCENTREALLOCATIONS.LIST><NAME>R&amp;D</NAME><AMOUNT>-30000.00</AMOUNT></COSTCENTREALLOCATIONS.LIST>');
    expect(voucher).toMatch(/<LEDGERNAME>Salary Payable<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><AMOUNT>26999\.50<\/AMOUNT>/);
    const masters = tallyMastersXml(lines, groups, settings);
    expect(masters).toContain('<REPORTNAME>All Masters</REPORTNAME>');
    expect(masters).toContain('<LEDGER NAME="PF Payable" ACTION="Create"><NAME.LIST><NAME>PF Payable</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT></LEDGER>');
    expect(masters).toContain('<COSTCENTRE NAME="R&amp;D" ACTION="Create">');
    expect(tallyName('  <Sales>  "North" ')).toBe('Sales North');
  });
});

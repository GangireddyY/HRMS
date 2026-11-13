import { amountInWords, payslipPdf, rupeesInWords } from './payslip-pdf';

describe('payslip PDF', () => {
  it('writes amounts in words, Indian style for rupees', () => {
    expect(rupeesInWords(0)).toBe('Zero rupees only');
    expect(rupeesInWords(125_000)).toBe('One lakh twenty-five thousand rupees only');
    expect(rupeesInWords(1_23_45_678)).toBe('One crore twenty-three lakh forty-five thousand six hundred seventy-eight rupees only');
    expect(rupeesInWords(99.6)).toBe('One hundred rupees only');
    expect(amountInWords(1_250_000, 'USD')).toBe('One million two hundred fifty thousand USD only');
    expect(amountInWords(0, 'AED')).toBe('Zero AED only');
    expect(amountInWords(42, 'INR')).toBe('Forty-two rupees only');
  });

  const input = {
    organization: { name: 'Acme Technologies', address: 'MG Road, Bengaluru' },
    period: 'November 2026',
    employee: { name: 'Asha Rao', employeeCode: 'EMP-0007', designation: 'Engineer', department: 'Engineering', location: 'Bengaluru', dateOfJoining: '2024-01-08', pan: 'ABCDE1234F', uan: '100200300400', bank: { name: 'HDFC Bank', accountLast4: '9012' } },
    daysInMonth: 30,
    payableDays: 29,
    lopDays: 1,
    earnings: [
      { name: 'Basic', amount: 50_000 },
      { name: 'House rent allowance — metro', amount: 20_000 },
    ],
    deductions: [
      { name: 'Provident fund', amount: 1_800 },
      { name: 'Income tax (TDS)', amount: 6_500 },
    ],
    employerContributions: [{ name: 'Employer PF', amount: 1_800 }],
    gross: 70_000,
    totalDeductions: 8_300,
    netPay: 61_700,
  };

  it('renders an A4 PDF, optionally password-protected', async () => {
    const plain = await payslipPdf(input);
    expect(plain.subarray(0, 5).toString()).toBe('%PDF-');
    expect(plain.length).toBeGreaterThan(1_500);
    expect(plain.includes('/Encrypt')).toBe(false);
    const locked = await payslipPdf({ ...input, currency: 'USD', employee: { ...input.employee, bank: null, pan: null } }, { password: 'ASHA0801' });
    expect(locked.includes('/Encrypt')).toBe(true);
  });
});

import { Op, type Transaction } from 'sequelize';
import { EmployeeLoan, EmployeeLoanRepayment } from '../../database/models';
import { monthIndex, nextInstalment, type Instalment } from './loan-rules';

export interface LoanBalance {
  repaidPrincipal: number;
  repaidInterest: number;
  outstanding: number;
  instalments: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What has been repaid on each loan and what is still owed (principal). */
export async function loanBalances(loans: EmployeeLoan[], transaction?: Transaction): Promise<Map<string, LoanBalance>> {
  const out = new Map<string, LoanBalance>();
  if (!loans.length) return out;
  const repayments = await EmployeeLoanRepayment.findAll({ where: { loanId: loans.map((l) => l.id) }, attributes: ['loanId', 'principal', 'interest', 'source'], transaction });
  for (const l of loans) {
    const rows = repayments.filter((r) => r.loanId === l.id);
    const repaidPrincipal = round2(rows.reduce((s, r) => s + Number(r.principal), 0));
    out.set(l.id, {
      repaidPrincipal,
      repaidInterest: round2(rows.reduce((s, r) => s + Number(r.interest), 0)),
      outstanding: l.status === 'ACTIVE' || l.status === 'CLOSED' ? Math.max(0, round2(Number(l.principal) - repaidPrincipal)) : 0,
      instalments: rows.filter((r) => r.source === 'PAYROLL').length,
    });
  }
  return out;
}

export interface DueInstalment extends Instalment {
  loanId: string;
  reference: string;
  type: EmployeeLoan['type'];
}

/** Instalments payroll deducts for the month: disbursed loans whose deductions have started and that are not repaid yet. */
export async function dueInstalments(employeeIds: string[], year: number, month: number, transaction?: Transaction): Promise<Map<string, DueInstalment[]>> {
  const out = new Map<string, DueInstalment[]>();
  if (!employeeIds.length) return out;
  const loans = (await EmployeeLoan.findAll({ where: { employeeId: employeeIds, status: 'ACTIVE', startYear: { [Op.ne]: null } }, order: [['createdAt', 'ASC']], transaction })).filter(
    (l) => monthIndex(l.startYear!, l.startMonth!) <= monthIndex(year, month),
  );
  const balances = await loanBalances(loans, transaction);
  for (const l of loans) {
    const i = nextInstalment(balances.get(l.id)!.outstanding, Number(l.interestRate), Number(l.emi));
    if (i.amount <= 0) continue;
    out.set(l.employeeId, [...(out.get(l.employeeId) ?? []), { loanId: l.id, reference: l.reference, type: l.type, ...i }]);
  }
  return out;
}

/** Closes loans that have nothing left to repay. */
export async function closeRepaidLoans(loanIds: string[], transaction: Transaction): Promise<string[]> {
  if (!loanIds.length) return [];
  const loans = await EmployeeLoan.findAll({ where: { id: loanIds, status: 'ACTIVE' }, transaction });
  const balances = await loanBalances(loans, transaction);
  const repaid = loans.filter((l) => balances.get(l.id)!.outstanding <= 0);
  if (repaid.length) await EmployeeLoan.update({ status: 'CLOSED', closedAt: new Date() }, { where: { id: repaid.map((l) => l.id) }, transaction });
  return repaid.map((l) => l.reference);
}

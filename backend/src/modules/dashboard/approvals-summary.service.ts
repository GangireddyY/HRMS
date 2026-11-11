import { Injectable, Logger } from '@nestjs/common';
import type { ModuleKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { OvertimeQueryDto, RegularizationQueryDto, ShiftSwapQueryDto, TimesheetQueryDto, WorkFromHomeQueryDto } from '../attendance/dto/attendance.dto';
import { OvertimeService } from '../attendance/overtime.service';
import { RegularizationService } from '../attendance/regularization.service';
import { ShiftSwapsService } from '../attendance/shift-swaps.service';
import { TimesheetsService } from '../attendance/timesheets.service';
import { WorkFromHomeService } from '../attendance/work-from-home.service';
import { BankDetailsService } from '../employees/bank-details.service';
import { ExitQueryDto } from '../exit/dto/exit.dto';
import { ExitsService } from '../exit/exits.service';
import { CompOffService } from '../leave/comp-off.service';
import { CompOffQueryDto, EncashmentQueryDto, LeaveRequestQueryDto } from '../leave/dto/leave.dto';
import { EncashmentsService } from '../leave/encashments.service';
import { LeaveRequestsService } from '../leave/leave-requests.service';
import { ProbationReviewQueryDto } from '../onboarding/dto/onboarding.dto';
import { ProbationService } from '../onboarding/probation.service';
import { ClaimQueryDto, LoanQueryDto, RunQueryDto } from '../payroll/dto/payroll.dto';
import { LoansService } from '../payroll/loans.service';
import { PayrollRunsService } from '../payroll/payroll-runs.service';
import { ReimbursementsService } from '../payroll/reimbursements.service';
import { SalariesService } from '../payroll/salaries.service';
import { RequisitionQueryDto } from '../recruitment/dto/recruitment.dto';
import { RequisitionsService } from '../recruitment/requisitions.service';
import { AssetsService } from '../services/assets.service';
import { AssetRequestQueryDto, TravelQueryDto } from '../services/services.dto';
import { TravelService } from '../services/travel.service';

type Paged = { meta: { total: number } };
interface Source {
  key: string;
  /** Any of these (with the feature) lets the person decide; the same rule as the menu. */
  allowed: (auth: AuthContext) => boolean;
  count: (auth: AuthContext) => Promise<number>;
}

const has = (auth: AuthContext, ...keys: string[]) => keys.every((k) => auth.permissions.has(k));
const on = (auth: AuthContext, feature: ModuleKey) => auth.features.has(feature);
/** A one-row page of a list endpoint's query, so only the total is computed. */
function q<T extends object>(Dto: new () => T, values: Record<string, unknown>): T {
  return Object.assign(new Dto(), { page: 1, pageSize: 1, ...values });
}
const total = (p: Promise<unknown>) => p.then((r) => (r as Paged).meta.total);

/**
 * Everything waiting for this person's decision, counted in one request (the HR dashboard and the approvals menu),
 * through each module's own list logic, so scopes and approval cover are exactly what the lists show. A source that
 * fails is reported as `failed` instead of failing the whole summary.
 */
@Injectable()
export class ApprovalsSummaryService {
  private readonly logger = new Logger(ApprovalsSummaryService.name);
  private readonly sources: Source[];

  constructor(
    bank: BankDetailsService,
    salaries: SalariesService,
    leave: LeaveRequestsService,
    encashments: EncashmentsService,
    compOffs: CompOffService,
    regularizations: RegularizationService,
    wfh: WorkFromHomeService,
    overtime: OvertimeService,
    swaps: ShiftSwapsService,
    timesheets: TimesheetsService,
    claims: ReimbursementsService,
    loans: LoansService,
    runs: PayrollRunsService,
    requisitions: RequisitionsService,
    exits: ExitsService,
    travel: TravelService,
    assets: AssetsService,
    probation: ProbationService,
  ) {
    const attendance = (a: AuthContext) => has(a, 'attendance.regularize.approve') && on(a, 'attendance');
    this.sources = [
      { key: 'bank-changes', allowed: (a) => has(a, 'employee.update', 'employee.sensitive.view'), count: async (a) => (await bank.list(a)).filter((r: { canReview?: boolean }) => r.canReview).length },
      { key: 'salary-revisions', allowed: (a) => has(a, 'employee.salary.approve', 'employee.salary.view') && on(a, 'payroll'), count: async (a) => (await salaries.revisions(a, 'PENDING')).filter((r: { canReview?: boolean }) => r.canReview).length },
      { key: 'leave', allowed: (a) => has(a, 'leave.approve') && on(a, 'leave'), count: (a) => total(leave.list(a, q(LeaveRequestQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'encashments', allowed: (a) => has(a, 'leave.allocate') && on(a, 'leave'), count: (a) => total(encashments.list(a, q(EncashmentQueryDto, { view: 'all', status: 'PENDING' }))) },
      { key: 'comp-off', allowed: (a) => has(a, 'leave.approve') && on(a, 'leave'), count: (a) => total(compOffs.list(a, q(CompOffQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'regularizations', allowed: attendance, count: (a) => total(regularizations.list(a, q(RegularizationQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'wfh', allowed: attendance, count: (a) => total(wfh.list(a, q(WorkFromHomeQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'overtime', allowed: attendance, count: (a) => total(overtime.list(a, q(OvertimeQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'swaps', allowed: attendance, count: (a) => total(swaps.list(a, q(ShiftSwapQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'timesheets', allowed: (a) => has(a, 'attendance.timesheet.approve') && on(a, 'attendance'), count: (a) => total(timesheets.list(a, q(TimesheetQueryDto, { view: 'team', status: 'SUBMITTED' }))) },
      { key: 'claims', allowed: (a) => has(a, 'payroll.reimbursement.approve') && on(a, 'payroll'), count: (a) => total(claims.list(a, q(ClaimQueryDto, { view: 'approve', status: 'PENDING' }))) },
      { key: 'claims-finance', allowed: (a) => has(a, 'payroll.reimbursement.finance') && on(a, 'payroll'), count: (a) => total(claims.list(a, q(ClaimQueryDto, { view: 'finance' }))) },
      { key: 'loans', allowed: (a) => has(a, 'payroll.loan.approve') && on(a, 'payroll'), count: (a) => total(loans.list(a, q(LoanQueryDto, { view: 'approve' }))) },
      { key: 'payroll', allowed: (a) => has(a, 'payroll.approve') && on(a, 'payroll'), count: () => total(runs.list(q(RunQueryDto, { status: 'SUBMITTED' }))) },
      { key: 'requisitions', allowed: (a) => has(a, 'recruitment.requisition.approve') && on(a, 'recruitment'), count: (a) => total(requisitions.list(a, q(RequisitionQueryDto, { view: 'approve' }))) },
      { key: 'exits', allowed: (a) => (has(a, 'exit.approve') || has(a, 'exit.manage')) && on(a, 'exit'), count: (a) => total(exits.list(a, q(ExitQueryDto, { view: 'approve' }))) },
      { key: 'travel', allowed: (a) => has(a, 'travel.approve') && on(a, 'travel'), count: (a) => total(travel.list(a, q(TravelQueryDto, { view: 'team', status: 'PENDING' }))) },
      { key: 'asset-requests', allowed: (a) => has(a, 'assets.manage') && on(a, 'assets'), count: (a) => total(assets.requests(a, q(AssetRequestQueryDto, { view: 'all', status: 'PENDING' }))) },
      { key: 'probation', allowed: (a) => has(a, 'onboarding.confirmation.approve') && on(a, 'onboarding'), count: (a) => total(probation.list(a, q(ProbationReviewQueryDto, { view: 'approve' }))) },
    ];
  }

  async summary(auth: AuthContext): Promise<{ key: string; count: number; failed?: true }[]> {
    const mine = this.sources.filter((s) => s.allowed(auth));
    const results = await Promise.allSettled(mine.map((s) => s.count(auth)));
    return mine.map((s, i) => {
      const r = results[i]!;
      if (r.status === 'fulfilled') return { key: s.key, count: r.value };
      this.logger.warn(`Approval count "${s.key}" failed: ${(r.reason as Error)?.message ?? r.reason}`);
      return { key: s.key, count: 0, failed: true as const };
    });
  }
}

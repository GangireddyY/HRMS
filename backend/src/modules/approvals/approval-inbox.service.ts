import { Injectable } from '@nestjs/common';
import type { ApprovalInboxItem, ApprovalSubject, ModuleKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { fullName } from '../../common/utils/names';
import { ApprovalInstance, Candidate, Employee, ExitCase, JobApplication, LeaveRequest, LeaveType, Offer, ReimbursementClaim, TravelRequest } from '../../database/models';
import { ApprovalChainsService } from './approval-chains.service';

const MODULE_OF: Record<ApprovalSubject, ModuleKey> = { LEAVE: 'leave', EXPENSE: 'payroll', TRAVEL: 'travel', EXIT: 'exit', OFFER: 'recruitment' };

/**
 * Everything waiting at an approval-chain step this person decides, across kinds of request, with enough of each
 * request to decide from (the "My approvals" page). Approvers may be outside the module's usual roles, e.g. a named
 * budget owner; the decision itself goes through the module's own approve / reject endpoint.
 */
@Injectable()
export class ApprovalInboxService {
  constructor(private readonly chains: ApprovalChainsService) {}

  async waiting(auth: AuthContext): Promise<ApprovalInboxItem[]> {
    if (!auth.membershipId) return [];
    const pending = await ApprovalInstance.findAll({ where: { status: 'PENDING' }, order: [['stepStartedAt', 'ASC']] });
    const mine = pending.filter((i) => auth.features.has(MODULE_OF[i.subject]) && this.chains.actingFor(auth, i) !== null);
    const ids = (s: ApprovalSubject) => mine.filter((i) => i.subject === s).map((i) => i.subjectId);
    const [leave, claims, trips, exits, offers] = await Promise.all([
      ids('LEAVE').length ? LeaveRequest.findAll({ where: { id: ids('LEAVE') }, include: [{ model: LeaveType, attributes: ['name'] }] }) : [],
      ids('EXPENSE').length ? ReimbursementClaim.findAll({ where: { id: ids('EXPENSE') } }) : [],
      ids('TRAVEL').length ? TravelRequest.findAll({ where: { id: ids('TRAVEL') } }) : [],
      ids('EXIT').length ? ExitCase.findAll({ where: { id: ids('EXIT') } }) : [],
      ids('OFFER').length ? Offer.findAll({ where: { id: ids('OFFER') } }) : [],
    ]);
    const employeeIds = [...leave, ...claims, ...trips, ...exits].map((r) => r.employeeId);
    const people = employeeIds.length ? new Map((await Employee.findAll({ where: { id: [...new Set(employeeIds)] }, attributes: ['id', 'firstName', 'lastName'] })).map((e) => [e.id, fullName(e)])) : new Map<string, string>();
    const apps = offers.length
      ? new Map((await JobApplication.findAll({ where: { id: offers.map((o) => o.applicationId) }, attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] })).map((a) => [a.id, a.candidate ? fullName(a.candidate) : 'Candidate']))
      : new Map<string, string>();
    const who = (employeeId: string) => people.get(employeeId) ?? 'Former employee';

    const describe = (i: ApprovalInstance): Pick<ApprovalInboxItem, 'title' | 'detail' | 'person' | 'amount' | 'suggestedDate'> | null => {
      switch (i.subject) {
        case 'LEAVE': {
          const r = leave.find((x) => x.id === i.subjectId);
          return r ? { person: who(r.employeeId), title: `${r.leaveType?.name ?? 'Leave'}: ${Number(r.days)} day${Number(r.days) === 1 ? '' : 's'}`, detail: r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`, amount: null, suggestedDate: null } : null;
        }
        case 'EXPENSE': {
          const r = claims.find((x) => x.id === i.subjectId);
          return r ? { person: who(r.employeeId), title: r.title, detail: r.category.toLowerCase().replace(/_/g, ' '), amount: Number(r.amount), suggestedDate: null } : null;
        }
        case 'TRAVEL': {
          const r = trips.find((x) => x.id === i.subjectId);
          return r ? { person: who(r.employeeId), title: `${r.fromCity} to ${r.toCity}`, detail: `${r.departureDate} to ${r.returnDate} · ${r.purpose}`, amount: Number(r.estimatedCost), suggestedDate: null } : null;
        }
        case 'EXIT': {
          const r = exits.find((x) => x.id === i.subjectId);
          return r ? { person: who(r.employeeId), title: 'Resignation', detail: `Submitted ${r.submittedOn} · notice ends ${r.noticeEndsOn}`, amount: null, suggestedDate: r.requestedLastDay ?? r.noticeEndsOn } : null;
        }
        case 'OFFER': {
          const r = offers.find((x) => x.id === i.subjectId);
          return r ? { person: apps.get(r.applicationId) ?? 'Candidate', title: 'Job offer', detail: `Joining ${r.joiningDate}`, amount: Number(r.annualCtc), suggestedDate: null } : null;
        }
      }
    };

    const out: ApprovalInboxItem[] = [];
    // Offers without a chain wait for anyone who approves offers (never whoever drafted or sent them).
    if (auth.features.has('recruitment') && auth.permissions.has('recruitment.offer.approve')) {
      const onChains = new Set((await ApprovalInstance.findAll({ where: { subject: 'OFFER', status: 'PENDING' }, attributes: ['subjectId'] })).map((i) => i.subjectId));
      const legacy = (await Offer.findAll({ where: { status: 'DRAFT', approvalStatus: 'PENDING' }, order: [['approvalRequestedAt', 'ASC']] })).filter(
        (o) => !onChains.has(o.id) && o.createdById !== auth.userId && o.approvalRequestedById !== auth.userId,
      );
      const names = legacy.length
        ? new Map((await JobApplication.findAll({ where: { id: legacy.map((o) => o.applicationId) }, attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] })).map((a) => [a.id, a.candidate ? fullName(a.candidate) : 'Candidate']))
        : new Map<string, string>();
      for (const o of legacy) {
        const since = o.approvalRequestedAt ?? o.updatedAt;
        out.push({ id: o.id, subject: 'OFFER', subjectId: o.id, chain: 'Offer approval', step: 'Approver', stepNumber: 1, steps: 1, waitingSince: since.toISOString(), dueAt: null, escalated: false, onBehalf: false, person: names.get(o.applicationId) ?? 'Candidate', title: 'Job offer', detail: `Joining ${o.joiningDate}`, amount: Number(o.annualCtc), suggestedDate: null });
      }
    }
    for (const i of mine) {
      const d = describe(i);
      if (!d) continue;
      const actingFor = this.chains.actingFor(auth, i);
      out.push({
        id: i.id,
        subject: i.subject,
        subjectId: i.subjectId,
        chain: i.chainName,
        step: i.steps[i.currentStep]?.label ?? '',
        stepNumber: i.currentStep + 1,
        steps: i.steps.length,
        waitingSince: i.stepStartedAt.toISOString(),
        dueAt: i.dueAt?.toISOString() ?? null,
        escalated: !!i.escalatedAt,
        onBehalf: actingFor !== auth.membershipId,
        ...d,
      });
    }
    return out;
  }
}

import { BenefitEnrollment, BenefitPlan, BenefitPlanOption, Department, Employee } from '../../database/models';
import { personRef } from '../employees/employee-people';

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export const ENROLLMENT_INCLUDE = () => [
  { model: BenefitPlan, attributes: ['id', 'name', 'type', 'provider', 'coverageEndsOn'] },
  { association: 'dependents' },
  { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
];

export function presentOption(o: BenefitPlanOption) {
  return {
    id: o.id,
    name: o.name,
    coverageAmount: num(o.coverageAmount),
    employeeMonthly: Number(o.employeeMonthly),
    employerMonthly: Number(o.employerMonthly),
    allowedRelations: o.allowedRelations,
    maxDependents: o.maxDependents,
    isDefault: o.isDefault,
  };
}

export function presentPlan(p: BenefitPlan) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    provider: p.provider,
    policyNumber: p.policyNumber,
    description: p.description,
    status: p.status,
    coverageStartsOn: p.coverageStartsOn,
    coverageEndsOn: p.coverageEndsOn,
    enrollmentOpensOn: p.enrollmentOpensOn,
    enrollmentClosesOn: p.enrollmentClosesOn,
    mandatory: p.mandatory,
    requiresApproval: p.requiresApproval,
    employmentTypes: p.employmentTypes,
    departmentIds: p.departmentIds,
    locationIds: p.locationIds,
    gradeIds: p.gradeIds,
    waitingDays: p.waitingDays,
    maxChildAge: p.maxChildAge,
    options: [...(p.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(presentOption),
    renewedFromId: p.renewedFromId,
    updatedAt: p.updatedAt,
  };
}

export function presentEnrollment(e: BenefitEnrollment, names: Map<string, string> = new Map()) {
  return {
    id: e.id,
    plan: e.plan ? { id: e.plan.id, name: e.plan.name, type: e.plan.type, provider: e.plan.provider } : { id: e.planId },
    employee: e.employee ? { ...personRef(e.employee)!, department: e.employee.department?.name ?? null } : null,
    status: e.status,
    reason: e.reason,
    lifeEvent: e.lifeEvent,
    lifeEventDate: e.lifeEventDate,
    note: e.note,
    effectiveFrom: e.effectiveFrom,
    effectiveTo: e.effectiveTo,
    option: e.optionId ? { id: e.optionId, name: e.optionName } : null,
    coverageAmount: num(e.coverageAmount),
    employeeMonthly: Number(e.employeeMonthly),
    employerMonthly: Number(e.employerMonthly),
    dependents: (e.dependents ?? []).map((d) => ({ id: d.id, familyMemberId: d.familyMemberId, name: d.name, relationship: d.relationship, dateOfBirth: d.dateOfBirth })),
    replacesId: e.replacesId,
    decidedBy: e.decidedById ? (names.get(e.decidedById) ?? 'Former user') : null,
    decidedAt: e.decidedAt,
    decisionNote: e.decisionNote,
    createdAt: e.createdAt,
  };
}

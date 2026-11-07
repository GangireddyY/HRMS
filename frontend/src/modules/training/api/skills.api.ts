import type { SkillCategory } from '@contracts';
import { http, type ListQuery, type Page } from '@/core/http/http-client';
import type { MatrixRow, RoleRequirements, Skill, SkillLevelRow, SkillProfile } from '../types';

type Levels = { skillId: string; level: number }[];

export const skillsApi = {
  list: (q: { search?: string; category?: SkillCategory; includeInactive?: boolean } = {}) => http.get<Skill[]>('/skills', q),
  create: (body: { name: string; category: SkillCategory; description: string | null; isActive?: boolean }) => http.post<Skill>('/skills', body),
  update: (id: string, body: Partial<{ name: string; category: SkillCategory; description: string | null; isActive: boolean }>) => http.patch<Skill>(`/skills/${id}`, body),
  remove: (id: string) => http.delete<{ deleted: boolean }>(`/skills/${id}`),

  requirements: () => http.get<RoleRequirements[]>('/skills/requirements/all'),
  setRequirements: (designationId: string, skills: Levels) => http.put<RoleRequirements>(`/skills/requirements/${designationId}`, { skills }),
  courseSkills: (courseId: string) => http.get<SkillLevelRow[]>(`/skills/courses/${courseId}`),
  setCourseSkills: (courseId: string, skills: Levels) => http.put<SkillLevelRow[]>(`/skills/courses/${courseId}`, { skills }),

  mine: () => http.get<SkillProfile | null>('/skills/me/profile'),
  setMine: (body: { skillId: string; level: number; notes?: string | null }) => http.put<SkillProfile>('/skills/me/profile', body),
  removeMine: (skillId: string) => http.delete<SkillProfile>(`/skills/me/profile/${skillId}`),
  employee: (employeeId: string) => http.get<SkillProfile>(`/skills/employees/${employeeId}`),
  verify: (employeeId: string, skillId: string, level: number) => http.post<SkillProfile>(`/skills/employees/${employeeId}/${skillId}/verify`, { level }),
  matrix: (q: ListQuery & { departmentId?: string; designationId?: string }, skillIds: string[] = []) =>
    http.get<{ skills: { id: string; name: string; category: SkillCategory }[]; summary: { skillId: string; people: number; advanced: number; average: number | null }[]; page: Page<MatrixRow> }>('/skills/matrix/view', {
      ...q,
      skillIds: skillIds.length ? skillIds.join(',') : undefined,
    }),
};

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = { TECHNICAL: 'Technical', TOOL: 'Tool / platform', DOMAIN: 'Domain', SOFT: 'Soft skill', LANGUAGE: 'Language', OTHER: 'Other' };

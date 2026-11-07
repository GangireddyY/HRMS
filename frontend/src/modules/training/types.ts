import type { CourseCategory, CourseDelivery, CourseStatus, EnrollmentSource, EnrollmentStatus, SessionStatus, SkillCategory } from '@contracts';

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: CourseCategory;
  delivery: CourseDelivery;
  durationHours: number | null;
  provider: string | null;
  contentUrl: string | null;
  status: CourseStatus;
  selfEnrollment: boolean;
  mandatory: boolean;
  hasAssessment: boolean;
  passMark: number;
  maxAttempts: number;
  validityMonths: number | null;
  questionCount?: number;
}

export interface CourseRow extends Course {
  upcomingSessions: number;
  myEnrollment: { id: string; status: EnrollmentStatus; expiresOn: string | null; dueDate: string | null } | null;
  enrolled?: number;
  completed?: number;
}

export interface Session {
  id: string;
  courseId: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  trainer: string | null;
  capacity: number | null;
  status: SessionStatus;
  enrolled?: number;
  seatsLeft?: number | null;
}

export interface Question {
  id?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

export interface CourseDetail extends Course {
  sessions: Session[];
  questions?: Question[];
  myEnrollment: { id: string; status: EnrollmentStatus; expiresOn: string | null; sessionId: string | null } | null;
  feedback: { average: number | null; count: number };
  permissions: { manage: boolean; enroll: boolean; assign: boolean };
}

export type CourseInput = Omit<Course, 'id' | 'status' | 'questionCount'>;

export type CertificationState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

export interface Enrollment {
  id: string;
  course: { id: string; code: string; title: string; category: CourseCategory; delivery: CourseDelivery; durationHours: number | null; mandatory: boolean };
  employee: PersonRef & { department: string | null };
  session: Session | null;
  source: EnrollmentSource;
  dueDate: string | null;
  overdue: boolean;
  status: EnrollmentStatus;
  attended: boolean;
  attempts: number;
  bestScore: number | null;
  passed: boolean;
  startedAt: string | null;
  completedOn: string | null;
  certificateNumber: string | null;
  expiresOn: string | null;
  certification: CertificationState | null;
  createdAt: string;
}

export interface EnrollmentDetail extends Enrollment {
  course: Enrollment['course'] & Course;
  requirementsLeft: string[];
  attemptHistory: { id: string; score: number; passed: boolean; correct: number; total: number; createdAt: string }[];
  availableSessions: Session[];
  feedback: { rating: number; comment: string | null } | null;
  cancelReason: string | null;
  permissions: { start: boolean; markDone: boolean; attempt: boolean; changeSession: boolean; cancel: boolean; feedback: boolean };
}

export interface RosterRow {
  id: string;
  employee: PersonRef & { department: string | null };
  session: Session | null;
  source: EnrollmentSource;
  dueDate: string | null;
  status: EnrollmentStatus;
  attended: boolean;
  attempts: number;
  bestScore: number | null;
  completedOn: string | null;
  certificateNumber: string | null;
  expiresOn: string | null;
  feedbackRating: number | null;
}

export interface Assessment {
  passMark: number;
  attemptsLeft: number;
  questions: { id: string; prompt: string; options: string[] }[];
}

// ---- Skills ----

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string | null;
  isActive: boolean;
  people?: number;
}

export interface SkillLevelRow {
  skillId: string;
  name: string;
  category?: SkillCategory;
  level: number;
}

export interface SkillProfile {
  employee: { id: string; name: string; employeeCode: string };
  designation: { id: string; name: string } | null;
  skills: {
    skillId: string;
    name: string;
    category?: SkillCategory;
    level: number | null;
    verifiedLevel: number | null;
    verifiedSource: 'MANAGER' | 'TRAINING' | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
    effectiveLevel: number;
    notes: string | null;
    required: number | null;
  }[];
  requirements: { skillId: string; name: string; category?: SkillCategory; requiredLevel: number; current: number }[];
  readiness: number;
  gaps: { skillId: string; name: string; required: number; current: number; gap: number; courses: { id: string; code: string; title: string; delivery: CourseDelivery; teachesLevel: number; durationHours: number | null }[] }[];
  permissions: { edit: boolean; verify: boolean };
}

export interface RoleRequirements {
  designation: { id: string; name: string };
  skills: { skillId: string; name: string; category?: SkillCategory; requiredLevel: number }[];
}

export interface MatrixCell {
  skillId: string;
  level: number;
  selfLevel: number | null;
  verifiedLevel: number | null;
  required: number | null;
  gap: number;
}

export interface MatrixRow {
  employee: { id: string; name: string; employeeCode: string; department: string | null; designation: string | null };
  cells: MatrixCell[];
}

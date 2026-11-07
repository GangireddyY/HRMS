import type { ApplicationStage, CandidateSource, JobStatus, ParsedResume, RequisitionStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type {
  ApplicationCard,
  ApplicationDetail,
  Candidate,
  CandidateInput,
  InterviewItem,
  Job,
  JobDetail,
  JobInput,
  MyInterview,
  OfferInput,
  OfferSummary,
  PublicJob,
  Requisition,
  RequisitionInput,
} from '../types';

export interface InterviewInput {
  roundName: string;
  scheduledAt: string;
  durationMinutes?: number;
  mode?: InterviewItem['mode'];
  location?: string | null;
  panelistIds: string[];
}

export const recruitmentApi = {
  requisitions: (q: ListQuery & { view?: 'mine' | 'approve' | 'all'; status?: RequisitionStatus }) => http.page<Requisition>('/recruitment/requisitions', q),
  requisition: (id: string) => http.get<Requisition>(`/recruitment/requisitions/${id}`),
  createRequisition: (body: RequisitionInput) => http.post<Requisition>('/recruitment/requisitions', body),
  updateRequisition: (id: string, body: Partial<RequisitionInput>) => http.patch<Requisition>(`/recruitment/requisitions/${id}`, body),
  approveRequisition: (id: string, note?: string | null) => http.post<Requisition>(`/recruitment/requisitions/${id}/approve`, { note }),
  rejectRequisition: (id: string, note: string) => http.post<Requisition>(`/recruitment/requisitions/${id}/reject`, { note }),
  cancelRequisition: (id: string) => http.post<Requisition>(`/recruitment/requisitions/${id}/cancel`),

  jobs: (q: ListQuery & { status?: JobStatus }) => http.page<Job>('/recruitment/jobs', q),
  job: (id: string) => http.get<JobDetail>(`/recruitment/jobs/${id}`),
  createJob: (body: JobInput) => http.post<JobDetail>('/recruitment/jobs', body),
  updateJob: (id: string, body: Partial<JobInput>) => http.patch<JobDetail>(`/recruitment/jobs/${id}`, body),
  setJobStatus: (id: string, status: JobStatus) => http.post<JobDetail>(`/recruitment/jobs/${id}/status`, { status }),
  addToJob: (jobId: string, candidateId: string, source?: CandidateSource) => http.post<ApplicationDetail>(`/recruitment/jobs/${jobId}/applications`, { candidateId, source }),

  candidates: (q: ListQuery & { source?: CandidateSource }) => http.page<Candidate>('/recruitment/candidates', q),
  candidate: (id: string) => http.get<Candidate>(`/recruitment/candidates/${id}`),
  duplicates: (email?: string, phone?: string) => http.get<{ id: string; name: string; email: string; phone: string | null; match: 'EMAIL' | 'PHONE' }[]>('/recruitment/candidates/duplicates', { email, phone }),
  createCandidate: (body: CandidateInput) => http.post<Candidate>('/recruitment/candidates', body),
  updateCandidate: (id: string, body: Partial<CandidateInput>) => http.patch<Candidate>(`/recruitment/candidates/${id}`, body),
  removeCandidate: (id: string) => http.delete<{ deleted: boolean }>(`/recruitment/candidates/${id}`),
  parseResume: (file: File) => http.upload<{ parsed: ParsedResume; readable: boolean }>('/recruitment/resumes/parse', file, { fileName: file.name }),
  uploadResume: (id: string, file: File) => http.upload<Candidate>(`/recruitment/candidates/${id}/resume`, file, { fileName: file.name }),
  resumeBlob: (id: string) => http.download(`/recruitment/candidates/${id}/resume`),
  downloadResume: (id: string, fileName: string) => downloadFile(`/recruitment/candidates/${id}/resume`, undefined, fileName),

  applications: (q: ListQuery & { jobId?: string; stage?: ApplicationStage }) => http.page<ApplicationCard>('/recruitment/applications', q),
  application: (id: string) => http.get<ApplicationDetail>(`/recruitment/applications/${id}`),
  move: (id: string, stage: ApplicationStage, note?: string | null) => http.post<ApplicationDetail>(`/recruitment/applications/${id}/stage`, { stage, note }),
  schedule: (applicationId: string, body: InterviewInput) => http.post<ApplicationDetail>(`/recruitment/applications/${applicationId}/interviews`, body),
  updateInterview: (id: string, body: Partial<InterviewInput>) => http.patch<ApplicationDetail>(`/recruitment/interviews/${id}`, body),
  cancelInterview: (id: string) => http.post<ApplicationDetail>(`/recruitment/interviews/${id}/cancel`),
  completeInterview: (id: string) => http.post<ApplicationDetail>(`/recruitment/interviews/${id}/complete`),

  myInterviews: () => http.get<MyInterview[]>('/recruitment/my-interviews'),
  submitFeedback: (id: string, body: { rating: number; recommendation: string; feedback: string }) => http.post<MyInterview>(`/recruitment/interviews/${id}/feedback`, body),
  interviewResumeBlob: (id: string) => http.download(`/recruitment/interviews/${id}/resume`),

  createOffer: (applicationId: string, body: OfferInput) => http.post<OfferSummary>(`/recruitment/applications/${applicationId}/offers`, body),
  updateOffer: (id: string, body: Partial<OfferInput>) => http.patch<OfferSummary>(`/recruitment/offers/${id}`, body),
  releaseOffer: (id: string) => http.post<OfferSummary>(`/recruitment/offers/${id}/release`),
  respondOffer: (id: string, response: 'ACCEPTED' | 'DECLINED', reason?: string | null) => http.post<OfferSummary>(`/recruitment/offers/${id}/response`, { response, reason }),
  withdrawOffer: (id: string) => http.post<OfferSummary>(`/recruitment/offers/${id}/withdraw`),
  hire: (id: string, body: { startOnboarding?: boolean; employeeCode?: string | null }) =>
    http.post<{ employeeId: string; employeeCode: string; onboardingCaseId: string | null; onboardingError: string | null }>(`/recruitment/offers/${id}/hire`, body),
};

/** Public careers pages (no sign-in). */
export const careersApi = {
  page: (slug: string) => http.get<{ organization: { name: string; logoUrl: string | null; website: string | null }; jobs: PublicJob[] }>(`/careers/${encodeURIComponent(slug)}`),
  job: (slug: string, jobId: string) =>
    http.get<{ organization: { name: string; logoUrl: string | null }; job: PublicJob & { description: string; requirements: string | null } }>(`/careers/${encodeURIComponent(slug)}/jobs/${jobId}`),
  apply: (slug: string, jobId: string, resume: File, fields: Record<string, string | null | undefined>) =>
    http.upload<{ received: boolean; message: string }>(`/careers/${encodeURIComponent(slug)}/jobs/${jobId}/apply`, resume, { fileName: resume.name, fields }),
};

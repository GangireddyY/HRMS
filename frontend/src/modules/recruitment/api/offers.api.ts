import type { OfferApprovalStatus, OfferStatus, PrejoiningDocumentCategory } from '@contracts';
import { downloadFile, http, openDocument } from '@/core/http/http-client';

export interface OfferDetail {
  id: string;
  applicationId: string;
  status: OfferStatus;
  annualCtc: number;
  joiningDate: string;
  expiresOn: string | null;
  notes: string | null;
  designation: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  releasedAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  createdById: string | null;
  approval: { status: OfferApprovalStatus; required: string | null; requestedBy: string | null; requestedAt: string | null; decidedBy: string | null; decidedAt: string | null; note: string | null };
  signature: { name: string; at: string; ip: string | null; letterHash: string } | null;
  portal: { active: boolean; expiresAt: string | null };
  prejoining: { submittedAt: string | null; documents: number };
}

export interface PrejoiningDetails {
  dateOfBirth?: string | null;
  gender?: string | null;
  phone?: string | null;
  address?: string | null;
  permanentAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  maritalStatus?: string | null;
  bloodGroup?: string | null;
  nationality?: string | null;
  pan?: string | null;
}

export interface PrejoiningView {
  submittedAt: string | null;
  details: PrejoiningDetails | null;
  documents: { id: string; category: PrejoiningDocumentCategory; title: string; fileName: string; size: number; uploadedAt?: string }[];
}

export interface PortalView {
  organization: { name: string; logoUrl: string | null; brandColor: string | null };
  candidate: { name: string; firstName: string };
  offer: { status: OfferStatus; designation: string | null; location: string | null; joiningDate: string; expiresOn: string | null; expired: boolean };
  letterHtml: string | null;
  signature: { name: string; at: string; letterHash: string } | null;
  canRespond: boolean;
  prejoining: { open: boolean; hired: boolean; submittedAt: string | null; details: (PrejoiningDetails & { hasPan?: boolean }) | null; documents: PrejoiningView['documents']; maxDocuments: number };
}

export const offersApi = {
  get: (id: string) => http.get<OfferDetail>(`/recruitment/offers/${id}`),
  submitForApproval: (id: string) => http.post<OfferDetail>(`/recruitment/offers/${id}/submit-approval`),
  approve: (id: string, note?: string | null) => http.post<OfferDetail>(`/recruitment/offers/${id}/approve`, { note }),
  rejectApproval: (id: string, note: string) => http.post<OfferDetail>(`/recruitment/offers/${id}/reject-approval`, { note }),
  release: (id: string) => http.post<OfferDetail & { portalUrl: string; emailed: boolean }>(`/recruitment/offers/${id}/release`),
  resendLink: (id: string) => http.post<{ portalUrl: string; emailed: boolean }>(`/recruitment/offers/${id}/resend-link`),
  openLetter: (id: string) => openDocument(`/recruitment/offers/${id}/letter`),
  prejoining: (id: string) => http.get<PrejoiningView>(`/recruitment/offers/${id}/prejoining`),
  downloadPrejoiningDocument: (id: string, documentId: string, fileName: string) => downloadFile(`/recruitment/offers/${id}/prejoining/documents/${documentId}`, undefined, fileName),
  template: () => http.get<{ subject: string; body: string; isDefault: boolean; updatedAt: string | null }>('/recruitment/offer-letter-template'),
  saveTemplate: (body: { subject: string; body: string }) => http.put<{ subject: string; body: string; isDefault: boolean; updatedAt: string | null }>('/recruitment/offer-letter-template', body),
  settings: () => http.get<{ offerApprovalRequired: boolean }>('/recruitment/settings'),
  saveSettings: (offerApprovalRequired: boolean) => http.put<{ offerApprovalRequired: boolean }>('/recruitment/settings', { offerApprovalRequired }),
};

/** The candidate's private offer page (no sign-in; the token is the key). */
export const offerPortalApi = {
  view: (token: string) => http.get<PortalView>(`/offer-portal/${encodeURIComponent(token)}`),
  accept: (token: string, signedName: string) => http.post<PortalView>(`/offer-portal/${encodeURIComponent(token)}/accept`, { signedName, agree: true }),
  decline: (token: string, reason?: string | null) => http.post<PortalView>(`/offer-portal/${encodeURIComponent(token)}/decline`, { reason }),
  saveDetails: (token: string, body: PrejoiningDetails) => http.put<PortalView>(`/offer-portal/${encodeURIComponent(token)}/details`, body),
  upload: (token: string, file: File, category: PrejoiningDocumentCategory, title: string) =>
    http.upload<PortalView>(`/offer-portal/${encodeURIComponent(token)}/documents`, file, { fileName: file.name, fields: { category, title } }),
  removeDocument: (token: string, documentId: string) => http.delete<PortalView>(`/offer-portal/${encodeURIComponent(token)}/documents/${documentId}`),
};

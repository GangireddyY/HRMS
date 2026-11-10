import type { AssetCategory, AssetCondition, AssetRequestStatus, AssetStatus, HelpdeskCategory, HelpdeskPriority, HelpdeskStatus, TravelStatus } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { Asset, AssetDetail, AssetInput, AssetRequest, AssetSummary, HelpdeskStats, MyAssets, Ticket, TicketDetail, Trip, TripInput } from '../types';

export const assetsApi = {
  mine: () => http.get<MyAssets>('/assets/mine'),
  acknowledge: (assignmentId: string) => http.post<MyAssets>(`/assets/assignments/${assignmentId}/acknowledge`),
  request: (body: { category: AssetCategory; reason: string }) => http.post<MyAssets>('/assets/requests', body),
  cancelRequest: (id: string) => http.post<MyAssets>(`/assets/requests/${id}/cancel`),
  requests: (q: ListQuery & { view?: 'mine' | 'all'; status?: AssetRequestStatus }) => http.page<AssetRequest>('/assets/requests', q),
  fulfil: (id: string, body: { assetId: string; note?: string | null }) => http.post<{ id: string }>(`/assets/requests/${id}/fulfil`, body),
  reject: (id: string, note: string) => http.post<{ id: string }>(`/assets/requests/${id}/reject`, { note }),
  summary: () => http.get<AssetSummary>('/assets/summary'),
  list: (q: ListQuery & { status?: AssetStatus; category?: AssetCategory; employeeId?: string }) => http.page<Asset>('/assets', q),
  get: (id: string) => http.get<AssetDetail>(`/assets/${id}`),
  create: (body: AssetInput) => http.post<AssetDetail>('/assets', body),
  update: (id: string, body: Partial<AssetInput>) => http.patch<AssetDetail>(`/assets/${id}`, body),
  assign: (id: string, body: { employeeId: string; condition?: AssetCondition; note?: string | null }) => http.post<AssetDetail>(`/assets/${id}/assign`, body),
  returnAsset: (id: string, body: { condition: AssetCondition; note?: string | null }) => http.post<AssetDetail>(`/assets/${id}/return`, body),
  setStatus: (id: string, body: { status: Exclude<AssetStatus, 'ASSIGNED'>; note?: string | null }) => http.put<AssetDetail>(`/assets/${id}/status`, body),
};

export const helpdeskApi = {
  list: (q: ListQuery & { view?: 'mine' | 'queue'; status?: HelpdeskStatus | 'ACTIVE'; assignee?: 'me' | 'unassigned'; category?: HelpdeskCategory }) => http.page<Ticket>('/helpdesk/tickets', q),
  create: (body: { category: HelpdeskCategory; subject: string; description: string; priority?: HelpdeskPriority }) => http.post<TicketDetail>('/helpdesk/tickets', body),
  stats: () => http.get<HelpdeskStats>('/helpdesk/tickets/stats'),
  agents: () => http.get<{ id: string; name: string }[]>('/helpdesk/tickets/agents'),
  get: (id: string) => http.get<TicketDetail>(`/helpdesk/tickets/${id}`),
  reply: (id: string, body: { body: string; internal?: boolean; status?: HelpdeskStatus }) => http.post<TicketDetail>(`/helpdesk/tickets/${id}/messages`, body),
  update: (id: string, body: { status?: HelpdeskStatus; assigneeId?: string | null; priority?: HelpdeskPriority }) => http.patch<TicketDetail>(`/helpdesk/tickets/${id}`, body),
  rate: (id: string, body: { rating: number; comment?: string | null }) => http.post<TicketDetail>(`/helpdesk/tickets/${id}/rating`, body),
  close: (id: string) => http.post<TicketDetail>(`/helpdesk/tickets/${id}/close`),
};

export const travelApi = {
  list: (q: ListQuery & { view?: 'mine' | 'team' | 'all'; status?: TravelStatus }) => http.page<Trip>('/travel/requests', q),
  create: (body: TripInput) => http.post<Trip>('/travel/requests', body),
  get: (id: string) => http.get<Trip>(`/travel/requests/${id}`),
  approve: (id: string, note?: string | null) => http.post<Trip>(`/travel/requests/${id}/approve`, { note }),
  reject: (id: string, note: string) => http.post<Trip>(`/travel/requests/${id}/reject`, { note }),
  cancel: (id: string) => http.post<Trip>(`/travel/requests/${id}/cancel`),
  complete: (id: string) => http.post<Trip>(`/travel/requests/${id}/complete`),
  desk: (id: string, body: { bookingNotes?: string | null; advanceReference?: string | null }) => http.put<Trip>(`/travel/requests/${id}/desk`, body),
};

import type { ExchangeRateView, LegalEntityRegistration, LegalEntityView } from '@contracts';
import { http } from '@/core/http/http-client';

export interface LegalEntityInput {
  name: string;
  legalName: string;
  country: string;
  currency: string;
  registrations: LegalEntityRegistration[];
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  isDefault: boolean;
}

export interface ExchangeRates {
  base: string;
  rates: ExchangeRateView[];
  /** The rate in force per currency. */
  latest: ExchangeRateView[];
}

export const entitiesApi = {
  list: () => http.get<LegalEntityView[]>('/legal-entities'),
  save: (body: LegalEntityInput, id?: string) => (id ? http.put<LegalEntityView>(`/legal-entities/${id}`, body) : http.post<LegalEntityView>('/legal-entities', body)),
  remove: (id: string) => http.delete<void>(`/legal-entities/${id}`),
  assign: (legalEntityId: string | null, employeeIds: string[]) => http.post<LegalEntityView[]>('/legal-entities/assign', { legalEntityId, employeeIds }),
  rates: () => http.get<ExchangeRates>('/exchange-rates'),
  setRate: (body: { currency: string; rate: number; effectiveOn: string; source?: string | null }) => http.put<ExchangeRates>('/exchange-rates', body),
  removeRate: (id: string) => http.delete<ExchangeRates>(`/exchange-rates/${id}`),
};

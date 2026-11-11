import type {
  ApprovalChainProgress,
  AssetCategory,
  AssetCondition,
  AssetRequestStatus,
  AssetStatus,
  HelpdeskCategory,
  HelpdeskPriority,
  HelpdeskStatus,
  TravelMode,
  TravelStatus,
} from '@contracts';

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
  department: string | null;
}

// ---- Assets ------------------------------------------------------------------------------------

export interface Asset {
  id: string;
  tag: string;
  name: string;
  category: AssetCategory;
  serialNumber: string | null;
  model: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyUntil: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  location: { id: string; name: string } | null;
  notes: string | null;
  assignedTo: PersonRef | null;
  assignedAt: string | null;
}

export interface AssetDetail extends Asset {
  permissions: { manage: boolean };
  history: {
    id: string;
    employee: PersonRef | null;
    assignedAt: string;
    assignedBy: string | null;
    conditionOut: AssetCondition;
    acknowledgedAt: string | null;
    returnedAt: string | null;
    returnedBy: string | null;
    conditionIn: AssetCondition | null;
    note: string | null;
  }[];
}

export interface AssetInput {
  tag?: string | null;
  name: string;
  category: AssetCategory;
  serialNumber?: string | null;
  model?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyUntil?: string | null;
  condition?: AssetCondition;
  locationId?: string | null;
  notes?: string | null;
}

export interface AssetRequest {
  id: string;
  category: AssetCategory;
  reason: string;
  status: AssetRequestStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy?: string | null;
  createdAt: string;
  employee: PersonRef | null;
  asset: { id: string; tag: string; name: string } | null;
  permissions: { cancel: boolean };
}

export interface MyAssets {
  assets: (Asset & { assignmentId: string | null; acknowledgedAt: string | null; conditionOut: AssetCondition | null })[];
  requests: AssetRequest[];
  canRequest: boolean;
}

export interface AssetSummary {
  total: number;
  inStock: number;
  assigned: number;
  inRepair: number;
  retired: number;
  pendingRequests: number;
}

// ---- Helpdesk ----------------------------------------------------------------------------------

export interface Ticket {
  id: string;
  reference: string;
  category: HelpdeskCategory;
  subject: string;
  priority: HelpdeskPriority;
  status: HelpdeskStatus;
  employee: PersonRef | null;
  assignee: { id: string; name: string } | null;
  dueAt: string;
  overdue: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  lastActivityAt: string;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  messages: { id: string; author: string; fromAgent: boolean; internal: boolean; body: string; createdAt: string }[];
  permissions: { manage: boolean; reply: boolean; rate: boolean; reopen: boolean; close: boolean };
}

export interface HelpdeskStats {
  active: number;
  unassigned: number;
  overdue: number;
  mine: number;
  resolvedLast30Days: number;
  avgFirstResponseHours: number | null;
  withinTargetPercent: number | null;
  avgRating: number | null;
}

// ---- Travel ------------------------------------------------------------------------------------

export interface Trip {
  id: string;
  reference: string;
  employee: PersonRef | null;
  purpose: string;
  fromCity: string;
  toCity: string;
  departureDate: string;
  returnDate: string;
  mode: TravelMode;
  needsAccommodation: boolean;
  estimatedCost: number;
  advanceAmount: number;
  status: TravelStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  onBehalfOf: string | null;
  bookingNotes: string | null;
  advancePaidAt: string | null;
  advanceReference: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Set when a configured approval chain decides this trip. */
  chain: ApprovalChainProgress | null;
  permissions: { approve: boolean; cancel: boolean; complete: boolean; desk: boolean };
}

export interface TripInput {
  purpose: string;
  fromCity: string;
  toCity: string;
  departureDate: string;
  returnDate: string;
  mode: TravelMode;
  needsAccommodation?: boolean;
  estimatedCost: number;
  advanceAmount?: number;
}

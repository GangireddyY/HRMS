/** Vocabularies for assets, the HR helpdesk and travel requests, shared by the API and the web app. */

export const ASSET_CATEGORIES = ['LAPTOP', 'DESKTOP', 'MONITOR', 'PHONE', 'TABLET', 'ACCESSORY', 'ID_CARD', 'FURNITURE', 'VEHICLE', 'OTHER'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  LAPTOP: 'Laptop',
  DESKTOP: 'Desktop',
  MONITOR: 'Monitor',
  PHONE: 'Phone',
  TABLET: 'Tablet',
  ACCESSORY: 'Accessory',
  ID_CARD: 'ID / access card',
  FURNITURE: 'Furniture',
  VEHICLE: 'Vehicle',
  OTHER: 'Other',
};
export const ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
export const ASSET_REQUEST_STATUSES = ['PENDING', 'FULFILLED', 'REJECTED', 'CANCELLED'] as const;
export type AssetRequestStatus = (typeof ASSET_REQUEST_STATUSES)[number];

export const HELPDESK_CATEGORIES = ['PAYROLL', 'LEAVE_ATTENDANCE', 'BENEFITS', 'DOCUMENTS', 'POLICIES', 'IT', 'FACILITIES', 'OTHER'] as const;
export type HelpdeskCategory = (typeof HELPDESK_CATEGORIES)[number];
export const HELPDESK_CATEGORY_LABELS: Record<HelpdeskCategory, string> = {
  PAYROLL: 'Pay & tax',
  LEAVE_ATTENDANCE: 'Leave & attendance',
  BENEFITS: 'Benefits & insurance',
  DOCUMENTS: 'Letters & documents',
  POLICIES: 'Policies',
  IT: 'IT & access',
  FACILITIES: 'Facilities',
  OTHER: 'Something else',
};
export const HELPDESK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type HelpdeskPriority = (typeof HELPDESK_PRIORITIES)[number];
/** Resolution target from opening, in hours. */
export const HELPDESK_SLA_HOURS: Record<HelpdeskPriority, number> = { LOW: 120, NORMAL: 72, HIGH: 24, URGENT: 8 };
export const HELPDESK_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] as const;
export type HelpdeskStatus = (typeof HELPDESK_STATUSES)[number];
/** Resolved tickets close by themselves after this many days without a reply. */
export const HELPDESK_AUTO_CLOSE_DAYS = 7;

export const TRAVEL_MODES = ['FLIGHT', 'TRAIN', 'BUS', 'CAR', 'OTHER'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];

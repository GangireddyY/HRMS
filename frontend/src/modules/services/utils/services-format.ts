import type { Component } from 'vue';
import { Armchair, Box, BusFront, Car, CarFront, Computer, CreditCard, Headphones, Laptop, MapPin, Monitor, Plane, Smartphone, Tablet, TrainFront } from '@lucide/vue';
import type { AssetCategory, AssetCondition, AssetRequestStatus, AssetStatus, HelpdeskPriority, HelpdeskStatus, TravelMode, TravelStatus } from '@contracts';
import { formatDate } from '@/shared/utils/format';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = { IN_STOCK: 'In stock', ASSIGNED: 'Assigned', IN_REPAIR: 'In repair', RETIRED: 'Retired', LOST: 'Lost' };
export const assetStatusTone: Record<AssetStatus, Tone> = { IN_STOCK: 'success', ASSIGNED: 'brand', IN_REPAIR: 'warning', RETIRED: 'neutral', LOST: 'danger' };
export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = { NEW: 'New', GOOD: 'Good', FAIR: 'Fair', DAMAGED: 'Damaged' };
export const ASSET_REQUEST_STATUS_LABELS: Record<AssetRequestStatus, string> = { PENDING: 'Pending', FULFILLED: 'Handed over', REJECTED: 'Not approved', CANCELLED: 'Cancelled' };
export const assetRequestTone: Record<AssetRequestStatus, Tone> = { PENDING: 'warning', FULFILLED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
export const ASSET_ICONS: Record<AssetCategory, Component> = {
  LAPTOP: Laptop,
  DESKTOP: Computer,
  MONITOR: Monitor,
  PHONE: Smartphone,
  TABLET: Tablet,
  ACCESSORY: Headphones,
  ID_CARD: CreditCard,
  FURNITURE: Armchair,
  VEHICLE: Car,
  OTHER: Box,
};

export const HELPDESK_STATUS_LABELS: Record<HelpdeskStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', WAITING: 'Waiting on you', RESOLVED: 'Resolved', CLOSED: 'Closed' };
/** Agents see "Waiting on employee" for the same status. */
export const HELPDESK_STATUS_AGENT_LABELS: Record<HelpdeskStatus, string> = { ...HELPDESK_STATUS_LABELS, WAITING: 'Waiting on employee' };
export const helpdeskStatusTone: Record<HelpdeskStatus, Tone> = { OPEN: 'info', IN_PROGRESS: 'brand', WAITING: 'warning', RESOLVED: 'success', CLOSED: 'neutral' };
export const HELPDESK_PRIORITY_LABELS: Record<HelpdeskPriority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
export const helpdeskPriorityTone: Record<HelpdeskPriority, Tone> = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger' };

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = { FLIGHT: 'Flight', TRAIN: 'Train', BUS: 'Bus', CAR: 'Car / cab', OTHER: 'Other' };
export const TRAVEL_MODE_ICONS: Record<TravelMode, Component> = { FLIGHT: Plane, TRAIN: TrainFront, BUS: BusFront, CAR: CarFront, OTHER: MapPin };
export const TRAVEL_STATUS_LABELS: Record<TravelStatus, string> = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', CANCELLED: 'Cancelled', COMPLETED: 'Completed' };
export const travelStatusTone: Record<TravelStatus, Tone> = { PENDING: 'warning', APPROVED: 'brand', REJECTED: 'danger', CANCELLED: 'neutral', COMPLETED: 'success' };

/** "in 5h", "3h overdue" — time left to the resolution target. */
export function dueIn(dueAt: string, now = Date.now()): string {
  const hours = Math.round((new Date(dueAt).getTime() - now) / 3_600_000);
  const span = (h: number) => (h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`);
  if (hours < 0) return `${span(-hours)} overdue`;
  if (hours === 0) return 'due now';
  return `due in ${span(hours)}`;
}

/** "14 Nov 2026" for a day trip, else "14 Nov 2026 – 16 Nov 2026". */
export function tripDates(t: { departureDate: string; returnDate: string }): string {
  return t.departureDate === t.returnDate ? formatDate(t.departureDate) : `${formatDate(t.departureDate)} – ${formatDate(t.returnDate)}`;
}

/** Nights away for a trip (0 for a day trip). */
export function nights(departure: string, ret: string): number {
  return Math.max(0, Math.round((Date.parse(ret) - Date.parse(departure)) / 86_400_000));
}

import type { ShiftSwapStatus } from '@contracts';
import type { ShiftSwap } from '@/modules/attendance/types';

type Tone = 'warning' | 'info' | 'success' | 'danger' | 'neutral';

export const SWAP_STATUS: Record<ShiftSwapStatus, { label: string; tone: Tone }> = {
  ASKED: { label: 'Waiting for colleague', tone: 'info' },
  PENDING: { label: 'Waiting for manager', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  DECLINED: { label: 'Declined by colleague', tone: 'neutral' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
};

/** "Morning 06:00–14:00", or "Day off". */
export const swapShift = (s: ShiftSwap['requester']['shift']) => (s ? `${s.name} ${s.startTime}–${s.endTime}` : 'Day off');

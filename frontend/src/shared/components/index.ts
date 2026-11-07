/**
 * Reusable UI library. Import from '@/shared/components' rather than individual files.
 * Components here are presentation-only: no API calls and no feature-module imports.
 */

// Forms
export { default as AppButton } from './forms/AppButton.vue';
export { default as AppCheckbox } from './forms/AppCheckbox.vue';
export { default as AppDatePicker } from './forms/AppDatePicker.vue';
export { default as AppOtpInput } from './forms/AppOtpInput.vue';
export { default as AppSearchInput } from './forms/AppSearchInput.vue';
export { default as AppFormField } from './forms/AppFormField.vue';
export { default as AppInput } from './forms/AppInput.vue';
export { default as AppPasswordChecklist } from './forms/AppPasswordChecklist.vue';
export { default as AppSegmented } from './forms/AppSegmented.vue';
export { default as AppSelect } from './forms/AppSelect.vue';
export { default as AppSwitch } from './forms/AppSwitch.vue';
export { default as AppTextarea } from './forms/AppTextarea.vue';

// Data display
export { default as AppAvatar } from './data/AppAvatar.vue';
export { default as AppBadge } from './data/AppBadge.vue';
export { default as AppDataTable } from './data/AppDataTable.vue';
export { default as AppPagination } from './data/AppPagination.vue';
export { default as AppStatCard } from './data/AppStatCard.vue';
export { default as AppSparkline } from './data/AppSparkline.vue';
export { default as AppInsights } from './data/AppInsights.vue';
export { default as AppActionQueue } from './data/AppActionQueue.vue';
export { default as AppPersonList } from './data/AppPersonList.vue';
export { default as AppFacts } from './data/AppFacts.vue';
export { default as AppMonthCalendar } from './data/AppMonthCalendar.vue';
export { default as AppStatStrip } from './data/AppStatStrip.vue';
export type { StripItem } from './data/AppStatStrip.vue';
export { default as AppMiniMonth } from './data/AppMiniMonth.vue';
export { default as AppCalendarEvent } from './data/AppCalendarEvent.vue';
export type { Fact } from './data/AppFacts.vue';
export type { Insight } from './data/AppInsights.vue';
export type { QueueItem } from './data/AppActionQueue.vue';
export type { PersonRow } from './data/AppPersonList.vue';

// Feedback
export { default as AppAlert } from './feedback/AppAlert.vue';
export { default as AppConfirmDialog } from './feedback/AppConfirmDialog.vue';
export { default as AppEmptyState } from './feedback/AppEmptyState.vue';
export { default as AppErrorState } from './feedback/AppErrorState.vue';
export { default as AppModal } from './feedback/AppModal.vue';
export { default as AppSkeleton } from './feedback/AppSkeleton.vue';
export { default as AppToaster } from './feedback/AppToaster.vue';

// Layout
export { default as AppCard } from './layout/AppCard.vue';
export { default as AppDropdown } from './layout/AppDropdown.vue';
export { default as AppLogo } from './layout/AppLogo.vue';
export { default as AppMenuItem } from './layout/AppMenuItem.vue';
export { default as AppPageHeader } from './layout/AppPageHeader.vue';
export { default as AppTabs } from './layout/AppTabs.vue';
export { default as AppHero } from './layout/AppHero.vue';
export { default as AppQuickActions } from './layout/AppQuickActions.vue';
export { default as AppSection } from './layout/AppSection.vue';
export { default as AppSplit } from './layout/AppSplit.vue';
export { default as AppAddTile } from './layout/AppAddTile.vue';
export type { QuickAction } from './layout/AppQuickActions.vue';

export type { SelectOption, TableColumn } from './types';

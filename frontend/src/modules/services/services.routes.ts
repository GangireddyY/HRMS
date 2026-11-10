import type { RouteRecordRaw } from 'vue-router';

const assetViewers = { permissions: ['assets.view', 'assets.manage'], scope: 'TEAM' as const, feature: 'assets' as const };
const agents = { permissions: ['helpdesk.manage'], feature: 'helpdesk' as const };

/** HR operations (/hr): the asset register, the helpdesk queue and travel approvals / the travel desk. */
export const servicesHrRoutes: RouteRecordRaw[] = [
  { path: 'assets', name: 'hr-assets', component: () => import('./pages/AssetsPage.vue'), meta: { title: 'Assets', access: assetViewers } },
  { path: 'assets/:id', name: 'hr-asset', component: () => import('./pages/AssetPage.vue'), meta: { title: 'Asset', access: assetViewers } },
  { path: 'helpdesk', name: 'hr-helpdesk', component: () => import('./pages/HelpdeskQueuePage.vue'), meta: { title: 'Helpdesk', access: agents } },
  { path: 'helpdesk/:id', name: 'hr-ticket', component: () => import('./pages/TicketPage.vue'), meta: { title: 'Ticket', access: agents } },
  { path: 'travel', name: 'hr-travel', component: () => import('./pages/TravelPage.vue'), meta: { title: 'Travel', access: { permissions: ['travel.approve', 'travel.manage'], scope: 'TEAM', feature: 'travel' } } },
];

/** My Workspace (/me): assets you hold, your helpdesk tickets and business trips. */
export const servicesSelfRoutes: RouteRecordRaw[] = [
  { path: 'assets', name: 'me-assets', component: () => import('./pages/MyAssetsPage.vue'), meta: { title: 'My assets', access: { permissions: ['assets.request'], feature: 'assets' } } },
  { path: 'helpdesk', name: 'me-helpdesk', component: () => import('./pages/MyHelpdeskPage.vue'), meta: { title: 'HR helpdesk', access: { permissions: ['helpdesk.raise'], feature: 'helpdesk' } } },
  { path: 'helpdesk/:id', name: 'me-ticket', component: () => import('./pages/TicketPage.vue'), meta: { title: 'Ticket', access: { permissions: ['helpdesk.raise', 'helpdesk.manage'], feature: 'helpdesk' } } },
  { path: 'travel', name: 'me-travel', component: () => import('./pages/MyTravelPage.vue'), meta: { title: 'Business travel', access: { permissions: ['travel.request'], feature: 'travel' } } },
];

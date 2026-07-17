import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from '@/features/auth/route-guards';
import { CampaignsPage } from '@/features/campaigns/CampaignsPage';
import { CampaignDetailPage } from '@/features/campaigns/CampaignDetailPage';
import { WorkbenchPage } from './WorkbenchPage';

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: <Navigate to="/campaigns" replace />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <WorkbenchPage />,
        children: [
          { path: 'campaigns', element: <CampaignsPage /> },
          { path: 'campaigns/:id', element: <CampaignDetailPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

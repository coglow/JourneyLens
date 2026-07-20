import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from '@/features/auth/route-guards';
import { CampaignsPage } from '@/features/campaigns/CampaignsPage';
import { CampaignDetailPage } from '@/features/campaigns/CampaignDetailPage';
import { SegmentDetailPage } from '@/features/segments/SegmentDetailPage';
import { SegmentsPage } from '@/features/segments/SegmentsPage';
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
          { path: 'segments', element: <SegmentsPage /> },
          { path: 'segments/:id', element: <SegmentDetailPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

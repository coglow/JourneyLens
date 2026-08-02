import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from '@/features/auth/route-guards';
import { CampaignsPage } from '@/features/campaigns/CampaignsPage';
import { CampaignDetailPage } from '@/features/campaigns/CampaignDetailPage';
import { ExecutionDetailPage } from '@/features/executions/ExecutionDetailPage';
import { ExecutionsPage } from '@/features/executions/ExecutionsPage';
import { EventDetailPage } from '@/features/events/EventDetailPage';
import { EventsPage } from '@/features/events/EventsPage';
import { JourneyDetailPage } from '@/features/journeys/JourneyDetailPage';
import { JourneyEditorPage } from '@/features/journeys/JourneyEditorPage';
import { JourneyStatsPage } from '@/features/journeys/JourneyStatsPage';
import { JourneyVersionPage } from '@/features/journeys/JourneyVersionPage';
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
      { path: 'journeys/:id/:view', element: <JourneyEditorPage /> },
      { path: 'journeys/:id/versions/:versionId', element: <JourneyVersionPage /> },
      {
        element: <WorkbenchPage />,
        children: [
          { path: 'campaigns', element: <CampaignsPage /> },
          { path: 'campaigns/:id', element: <CampaignDetailPage /> },
          { path: 'journey-stats', element: <JourneyStatsPage /> },
          { path: 'journeys/:id', element: <JourneyDetailPage /> },
          { path: 'executions', element: <ExecutionsPage /> },
          { path: 'executions/:id', element: <ExecutionDetailPage /> },
          { path: 'events', element: <EventsPage /> },
          { path: 'events/:id', element: <EventDetailPage /> },
          { path: 'segments', element: <SegmentsPage /> },
          { path: 'segments/:id', element: <SegmentDetailPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

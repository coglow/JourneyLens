import { lazy } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from '@/features/auth/route-guards';
import { NotFoundPage } from './NotFoundPage';
import { PageError } from './PageError';
import { WorkbenchPage } from './WorkbenchPage';

const CampaignsPage = lazy(() =>
  import('@/features/campaigns/CampaignsPage').then((m) => ({ default: m.CampaignsPage })),
);
const CampaignDetailPage = lazy(() =>
  import('@/features/campaigns/CampaignDetailPage').then((m) => ({
    default: m.CampaignDetailPage,
  })),
);
const ExecutionDetailPage = lazy(() =>
  import('@/features/executions/ExecutionDetailPage').then((m) => ({
    default: m.ExecutionDetailPage,
  })),
);
const ExecutionsPage = lazy(() =>
  import('@/features/executions/ExecutionsPage').then((m) => ({ default: m.ExecutionsPage })),
);
const EventDetailPage = lazy(() =>
  import('@/features/events/EventDetailPage').then((m) => ({ default: m.EventDetailPage })),
);
const EventsPage = lazy(() =>
  import('@/features/events/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const JourneyDetailPage = lazy(() =>
  import('@/features/journeys/JourneyDetailPage').then((m) => ({ default: m.JourneyDetailPage })),
);
const JourneyEditorPage = lazy(() =>
  import('@/features/journeys/JourneyEditorPage').then((m) => ({ default: m.JourneyEditorPage })),
);
const JourneyStatsPage = lazy(() =>
  import('@/features/journeys/JourneyStatsPage').then((m) => ({ default: m.JourneyStatsPage })),
);
const JourneyVersionPage = lazy(() =>
  import('@/features/journeys/JourneyVersionPage').then((m) => ({ default: m.JourneyVersionPage })),
);
const SegmentDetailPage = lazy(() =>
  import('@/features/segments/SegmentDetailPage').then((m) => ({ default: m.SegmentDetailPage })),
);
const SegmentsPage = lazy(() =>
  import('@/features/segments/SegmentsPage').then((m) => ({ default: m.SegmentsPage })),
);
const OverviewPage = lazy(() =>
  import('@/features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: <Navigate to="/overview" replace />,
  },
  {
    element: <RequireAuth />,
    // 守卫自身出错时的兜底，整页展示。
    errorElement: <PageError standalone />,
    children: [
      {
        // 编辑器与版本页本身就是整页，出错时整页替换。
        errorElement: <PageError standalone />,
        children: [
          { path: 'journeys/:id/:view', element: <JourneyEditorPage /> },
          { path: 'journeys/:id/versions/:versionId', element: <JourneyVersionPage /> },
          {
            path: 'journeys/:id/versions/:versionId/simulation',
            element: <JourneyVersionPage simulationPage />,
          },
        ],
      },
      {
        element: <WorkbenchPage />,
        children: [
          {
            // 工作台内的页面出错只替换内容区，侧栏与头部保持可用。
            errorElement: <PageError />,
            children: [
              { path: 'overview', element: <OverviewPage /> },
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
      // 未登录时先由守卫跳转登录页，登录后未知地址显示 404 页。
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

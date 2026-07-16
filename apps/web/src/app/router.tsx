import { createBrowserRouter, type RouteObject } from 'react-router';
import { LoginRoute, RequireAuth } from '../features/auth/route-guards';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <WorkbenchPage />
      </RequireAuth>
    ),
  },
];

export const router = createBrowserRouter(appRoutes);

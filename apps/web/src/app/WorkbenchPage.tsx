import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { useAuth } from '@/features/auth/auth-provider';
import { RouteLoading } from './RouteLoading';
import { WorkbenchLayout } from './WorkbenchLayout';

export function WorkbenchPage() {
  const { account, loggingOut, logoutError, signOut } = useAuth();
  if (account === null) return null;

  return (
    <WorkbenchLayout
      account={account}
      loggingOut={loggingOut}
      logoutError={logoutError}
      onLogout={() => void signOut()}
    >
      {/* 页面代码按需加载时只替换内容区，侧栏和头部保持可用。 */}
      <Suspense fallback={<RouteLoading />}>
        <Outlet />
      </Suspense>
    </WorkbenchLayout>
  );
}

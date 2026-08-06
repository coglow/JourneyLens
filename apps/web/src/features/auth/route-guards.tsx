import type { ReactNode } from 'react';
import { Alert, Button, Card, Layout, Typography } from 'antd';
import { Navigate, Outlet } from 'react-router';
import { useAuth, type AuthContextValue } from './auth-provider';
import { LoginPage } from './LoginPage';

function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <Layout
      role="main"
      style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      {children}
    </Layout>
  );
}

function sessionFallbackNode(
  auth: Pick<AuthContextValue, 'status' | 'errorMessage' | 'retry'>,
): ReactNode | null {
  if (auth.status === 'loading') {
    return (
      <CenteredPage>
        <Typography.Text role="status">正在恢复登录状态…</Typography.Text>
      </CenteredPage>
    );
  }
  if (auth.status === 'error') {
    return (
      <CenteredPage>
        <Card style={{ width: 440, maxWidth: '100%' }}>
          <Typography.Title level={1}>JourneyLens</Typography.Title>
          <Alert type="error" showIcon title="暂时无法连接服务" description={auth.errorMessage} />
          <Button style={{ marginTop: 24 }} onClick={auth.retry}>
            重试
          </Button>
        </Card>
      </CenteredPage>
    );
  }
  return null;
}

/** 受保护路由：未登录时跳转到 /login。 */
export function RequireAuth() {
  const auth = useAuth();
  const fallback = sessionFallbackNode(auth);
  if (fallback !== null) return fallback;
  if (auth.status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** 登录页路由：已登录时回到工作台。 */
export function LoginRoute() {
  const auth = useAuth();
  const fallback = sessionFallbackNode(auth);
  if (fallback !== null) return fallback;
  if (auth.status === 'authenticated') return <Navigate to="/overview" replace />;
  return (
    <CenteredPage>
      <LoginPage />
    </CenteredPage>
  );
}

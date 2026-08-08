import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { DesktopOnlyGate } from './DesktopOnlyGate';
import { QueryProvider } from './QueryProvider';
import { router } from './router';
import { ThemeProvider } from './ThemeProvider';

/**
 * 组合根：语言与主题在此接入，窗口宽度门槛包住会话与路由。
 * 页面与守卫通过 useAuth 读取会话状态。
 */
export function App() {
  return (
    <ThemeProvider>
      <DesktopOnlyGate>
        <AuthProvider>
          <QueryProvider>
            <RouterProvider router={router} />
          </QueryProvider>
        </AuthProvider>
      </DesktopOnlyGate>
    </ThemeProvider>
  );
}

import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from './QueryProvider';
import { router } from './router';

/** 组合根：会话 Provider 包裹查询客户端，页面与守卫通过 useAuth 读取会话状态。 */
export function App() {
  return (
    <AuthProvider>
      <QueryProvider>
        <RouterProvider router={router} />
      </QueryProvider>
    </AuthProvider>
  );
}

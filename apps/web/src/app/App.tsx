import { RouterProvider } from 'react-router';
import { AuthProvider } from '../features/auth/auth-provider';
import { router } from './router';

/** 组合根：会话 Provider 包裹路由，页面与守卫通过 useAuth 读取会话状态。 */
export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

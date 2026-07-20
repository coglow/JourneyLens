import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from './QueryProvider';
import { router } from './router';
import { theme } from './theme';

/** 组合根：语言与主题在此接入，会话 Provider 包裹查询客户端，页面与守卫通过 useAuth 读取会话状态。 */
export function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={theme}
      modal={{ mask: { closable: false } }}
      drawer={{ mask: { closable: false } }}
    >
      <AuthProvider>
        <QueryProvider>
          <RouterProvider router={router} />
        </QueryProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}

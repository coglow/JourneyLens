import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { isSessionExpired } from '@/services/api';
import { useAuth } from '@/features/auth/auth-provider';

/** 查询客户端 Provider：提供查询客户端，并处理会话过期。 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { expireSession } = useAuth();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            networkMode: 'always',
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 0,
          },
          // 离线时也立即发起请求并反馈失败，避免恢复联网后自动补发此前的写入。
          mutations: { retry: false, networkMode: 'always' },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            if (isSessionExpired(error)) expireSession();
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (isSessionExpired(error)) expireSession();
          },
        }),
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

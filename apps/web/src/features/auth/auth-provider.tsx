import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CurrentAccount } from '@journeylens/shared';
import { ApiError, getApiErrorMessage, getCurrentAccount, logout } from './auth-api';

type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; account: CurrentAccount };

export interface AuthContextValue {
  status: SessionState['status'];
  account: CurrentAccount | null;
  errorMessage: string | undefined;
  loggingOut: boolean;
  logoutError: string | undefined;
  signIn: (account: CurrentAccount) => void;
  signOut: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();

  async function restoreSession(): Promise<void> {
    setSession({ status: 'loading' });
    try {
      const account = await getCurrentAccount();
      setSession({ status: 'authenticated', account });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession({ status: 'unauthenticated' });
      } else {
        setSession({ status: 'error', message: getApiErrorMessage(error) });
      }
    }
  }

  useEffect(() => {
    void restoreSession();
  }, []);

  async function signOut(): Promise<void> {
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await logout();
      setSession({ status: 'unauthenticated' });
    } catch (error) {
      setLogoutError(getApiErrorMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        status: session.status,
        account: session.status === 'authenticated' ? session.account : null,
        errorMessage: session.status === 'error' ? session.message : undefined,
        loggingOut,
        logoutError,
        signIn: (account) => setSession({ status: 'authenticated', account }),
        signOut,
        retry: () => void restoreSession(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return context;
}

import { useAuth } from '../auth/auth-provider';
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
    />
  );
}

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { demoBuild } from '../../shared/env.js';
import { AuthSession } from './session.js';

const AuthContext = createContext<AuthSession | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new AuthSession(!demoBuild));
  useEffect(() => session.connect(), [session]);
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const session = useContext(AuthContext);
  if (!session) throw new Error('AuthProvider is missing');
  return { session, snapshot: useSyncExternalStore(session.subscribe, session.getSnapshot) };
}

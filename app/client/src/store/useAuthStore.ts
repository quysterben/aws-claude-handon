import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { decodeJwtPayload } from '../utils/jwt';

interface AuthState {
  idToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (tokens: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
  }) => void;
  logout: () => void;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      idToken: null,
      accessToken: null,
      refreshToken: null,
      setSession: ({ idToken, accessToken, refreshToken }) =>
        set({ idToken, accessToken, refreshToken }),
      logout: () =>
        set({ idToken: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ idToken: state.idToken }),
    }
  )
);

interface ExpClaim {
  exp?: number;
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => {
    if (!state.idToken) {
      return false;
    }
    const claims = decodeJwtPayload<ExpClaim>(state.idToken);
    if (!claims?.exp) {
      return false;
    }
    return claims.exp * 1000 > Date.now();
  });
}

interface AuthUserClaims {
  email?: string;
  name?: string;
  'custom:role'?: string;
}

export interface AuthUser {
  email: string | null;
  name: string | null;
  role: string | null;
}

export function useAuthUser(): AuthUser | null {
  const idToken = useAuthStore((state) => state.idToken);
  if (!idToken) {
    return null;
  }
  const claims = decodeJwtPayload<AuthUserClaims>(idToken);
  if (!claims) {
    return null;
  }
  return {
    email: claims.email ?? null,
    name: claims.name ?? null,
    role: claims['custom:role'] ?? null,
  };
}

export default useAuthStore;

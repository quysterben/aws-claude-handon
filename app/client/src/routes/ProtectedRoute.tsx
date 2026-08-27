import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore, { useIsAuthenticated } from '../store/useAuthStore';

export default function ProtectedRoute() {
  const isAuthenticated = useIsAuthenticated();
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    if (!isAuthenticated) {
      logout();
    }
  }, [isAuthenticated, logout]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

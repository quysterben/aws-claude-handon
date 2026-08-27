import { Navigate, Outlet } from 'react-router-dom';
import { useIsAuthenticated } from '../store/useAuthStore';

export default function PublicOnlyRoute() {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import useAuthStore, { useAuthUser } from '../store/useAuthStore';

export default function HomePage() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthUser();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 8 }}>
        <Card sx={{ width: '100%' }}>
          <CardContent>
            <Typography variant="h5" component="h1" gutterBottom>
              Welcome{user?.name ? `, ${user.name}` : ''}
            </Typography>
            {user?.email && (
              <Typography variant="body1" color="text.secondary" gutterBottom>
                {user.email}
              </Typography>
            )}
            <Button variant="outlined" onClick={handleLogout} sx={{ mt: 2 }}>
              Log out
            </Button>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}

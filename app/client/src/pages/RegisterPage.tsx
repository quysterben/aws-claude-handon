import { useState, FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { registerRequest } from '../api/auth';
import { getErrorMessage } from '../api/errors';
import { validatePassword } from '../utils/passwordPolicy';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!name || !email) {
      setError('Name and email are required.');
      return;
    }

    const validationError = validatePassword(password);
    setPasswordError(validationError);
    if (validationError) {
      return;
    }

    setIsSubmitting(true);
    try {
      await registerRequest({ email, password, name });
      navigate('/login', {
        state: { message: 'Registration successful — please log in.' },
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs">
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 8 }}>
        <Card sx={{ width: '100%' }}>
          <CardContent>
            <Typography variant="h5" component="h1" gutterBottom>
              Register
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                required
                margin="normal"
                autoComplete="name"
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                fullWidth
                required
                margin="normal"
                autoComplete="email"
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) {
                    setPasswordError(null);
                  }
                }}
                fullWidth
                required
                margin="normal"
                autoComplete="new-password"
                error={Boolean(passwordError)}
                helperText={
                  passwordError ??
                  'Min 8 characters, with uppercase, lowercase, a digit, and a symbol.'
                }
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={isSubmitting}
                sx={{ mt: 2 }}
              >
                {isSubmitting ? <CircularProgress size={24} /> : 'Register'}
              </Button>
            </Box>
            <Typography variant="body2" sx={{ mt: 2 }}>
              Already have an account?{' '}
              <Link component={RouterLink} to="/login">
                Log in
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}

# Client Auth Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Login, Register, and Home (post-login) screens to `app/client`, wired to the existing `POST /auth/register` / `POST /auth/login` backend routes.

**Architecture:** A new `react-router-dom` route tree (`/login`, `/register`, `/`) sits inside the existing `App.tsx`, guarded by two small wrapper components (`ProtectedRoute`, `PublicOnlyRoute`) reading session state from a new `useAuthStore` (zustand + `persist` → `localStorage`). Pages call two thin API functions (`registerRequest`/`loginRequest`) built on the existing `apiClient` axios instance. No user-profile endpoint exists, so the Home page's displayed identity is decoded client-side from the login response's `idToken` JWT.

**Tech Stack:** React 19 + TypeScript (CRA/`react-scripts` 5.0.1), MUI (`@mui/material`), zustand (+ `persist` middleware), axios, new dependency `react-router-dom`.

**Spec:** `docs/superpowers/specs/2026-08-27-client-auth-screens-design.md`

## Global Constraints

- All UI is built with MUI components (`TextField`, `Button`, `Alert`, `Card`/`CardContent`, `Typography`, `Box`/`Container`, `CircularProgress`), using the existing `theme.ts`/`ThemeProvider` already wired in `src/index.tsx` — do not add another CSS/UI library.
- Session (`idToken`/`accessToken`/`refreshToken`) is held in a new `useAuthStore`, not the existing `useAppStore` (that store stays the generic sample per its own doc comment).
- Register never auto-logs-in (the backend returns no tokens from `/auth/register`) — success always routes to `/login`.
- All API error messages are shown verbatim from the backend's `{ message }` body; a generic fallback is used only when no `message` is present.
- Do **not** develop, modify, or execute any frontend test files (including the pre-existing `src/App.test.tsx`) at any point in this plan, per explicit user instruction — verification uses `npm run build` (a type-check + production bundle, not the test runner) instead. `src/App.test.tsx` is left completely untouched, even though it will assert stale content once `App.tsx` changes.
- `useIsAuthenticated()` must check both token presence and expiry (`idToken`'s decoded `exp` claim vs. `Date.now()`), not presence alone — no backend endpoint exists to verify a token server-side, so this stays a client-side-only check.
- Do **not** create git commits or branches during execution — this repo requires explicit user permission before every commit/branch (`.claude/rules/git-workflow.md`). Each task ends with a verification step, not a commit step; propose the diff and wait for the user's go-ahead to commit.
- Run all commands from `app/client/` (this is a separate project from `app/api/` within the same repo).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | Add `react-router-dom` dependency |
| `src/utils/jwt.ts` (new) | `decodeJwtPayload` — base64url-decode a JWT payload, no signature check |
| `src/api/errors.ts` (new) | `getErrorMessage` — extract a display message from an axios error |
| `src/api/auth.ts` (new) | `registerRequest`/`loginRequest` — typed calls to the two backend auth routes |
| `src/store/useAuthStore.ts` (new) | Session state (`persist`ed), `useIsAuthenticated`, `useAuthUser` selectors |
| `src/routes/ProtectedRoute.tsx` (new) | Redirect to `/login` when not authenticated |
| `src/routes/PublicOnlyRoute.tsx` (new) | Redirect to `/` when already authenticated |
| `src/utils/passwordPolicy.ts` (new) | `validatePassword` — mirrors the backend's Cognito password policy |
| `src/pages/LoginPage.tsx` (new) | Login form |
| `src/pages/RegisterPage.tsx` (new) | Register form |
| `src/pages/HomePage.tsx` (new) | Post-login landing page + logout |
| `src/App.tsx` (modify) | Route tree wiring, CRA boilerplate removed |
| `src/App.css` (delete) | CRA boilerplate rules for markup that no longer exists |
| `src/App.test.tsx` (not touched) | Left as-is — frontend tests are out of scope for this plan (see Global Constraints) |

---

### Task 1: Add `react-router-dom`

**Files:**
- Modify: `app/client/package.json`

**Interfaces:**
- Produces: the `react-router-dom` package available to import from in every later task.

- [ ] **Step 1: Install the dependency**

Run from `app/client/`:

```bash
npm install react-router-dom
```

- [ ] **Step 2: Verify**

Run: `cat package.json | grep react-router-dom`
Expected: a line like `"react-router-dom": "^7.18.2"` present in `dependencies`.

---

### Task 2: JWT payload decoder

**Files:**
- Create: `app/client/src/utils/jwt.ts`

**Interfaces:**
- Produces: `decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null`

- [ ] **Step 1: Write the implementation**

```ts
export function decodeJwtPayload<T = Record<string, unknown>>(
  token: string
): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/utils/jwt.ts`.

---

### Task 3: Auth API client + error-message helper

**Files:**
- Create: `app/client/src/api/errors.ts`
- Create: `app/client/src/api/auth.ts`

**Interfaces:**
- Consumes: default export of `app/client/src/api/client.ts` (existing `apiClient` axios instance).
- Produces: `getErrorMessage(error: unknown, fallback?: string): string`; `registerRequest(input: RegisterInput): Promise<RegisterResponse>`; `loginRequest(input: LoginInput): Promise<LoginResponse>`; types `RegisterInput`, `RegisterResponse`, `LoginInput`, `LoginResponse`.

- [ ] **Step 1: Write `src/api/errors.ts`**

```ts
import axios from 'axios';

export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
}
```

- [ ] **Step 2: Write `src/api/auth.ts`**

```ts
import apiClient from './client';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function registerRequest(
  input: RegisterInput
): Promise<RegisterResponse> {
  const { data } = await apiClient.post<RegisterResponse>(
    '/auth/register',
    input
  );
  return data;
}

export async function loginRequest(
  input: LoginInput
): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
  return data;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/api/errors.ts` or `src/api/auth.ts`.

---

### Task 4: `useAuthStore`

**Files:**
- Create: `app/client/src/store/useAuthStore.ts`

**Interfaces:**
- Consumes: `decodeJwtPayload` from `src/utils/jwt.ts` (Task 2).
- Produces: default export `useAuthStore` (zustand hook) with state `{ idToken, accessToken, refreshToken }` and actions `setSession({ idToken, accessToken, refreshToken })` / `logout()`; named exports `useIsAuthenticated(): boolean` and `useAuthUser(): AuthUser | null` where `AuthUser = { email: string | null; name: string | null; role: string | null }`.

- [ ] **Step 1: Write the implementation**

```ts
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
    { name: 'auth-storage' }
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/store/useAuthStore.ts`.

---

### Task 5: Route guards

**Files:**
- Create: `app/client/src/routes/ProtectedRoute.tsx`
- Create: `app/client/src/routes/PublicOnlyRoute.tsx`

**Interfaces:**
- Consumes: `useIsAuthenticated` from `src/store/useAuthStore.ts` (Task 4); `Navigate`/`Outlet` from `react-router-dom` (Task 1).
- Produces: default exports `ProtectedRoute` and `PublicOnlyRoute`, both zero-prop components meant to be used as a parent `<Route element={...}>` wrapping child `<Route>`s (rendered via `<Outlet />`).

- [ ] **Step 1: Write `src/routes/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useIsAuthenticated } from '../store/useAuthStore';

export default function ProtectedRoute() {
  const isAuthenticated = useIsAuthenticated();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 2: Write `src/routes/PublicOnlyRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useIsAuthenticated } from '../store/useAuthStore';

export default function PublicOnlyRoute() {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/routes/ProtectedRoute.tsx` or `src/routes/PublicOnlyRoute.tsx`.

---

### Task 6: `LoginPage`

**Files:**
- Create: `app/client/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `loginRequest` from `src/api/auth.ts` (Task 3); `getErrorMessage` from `src/api/errors.ts` (Task 3); default export `useAuthStore` from `src/store/useAuthStore.ts` (Task 4, specifically its `setSession` action).
- Produces: default export `LoginPage`, a zero-prop component mounted at route `/login`.

- [ ] **Step 1: Write the implementation**

```tsx
import { useState, FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
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
import { loginRequest } from '../api/auth';
import { getErrorMessage } from '../api/errors';
import useAuthStore from '../store/useAuthStore';

interface LocationState {
  message?: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const successMessage =
    (location.state as LocationState | null)?.message ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const tokens = await loginRequest({ email, password });
      setSession(tokens);
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs">
      <Box display="flex" flexDirection="column" alignItems="center" mt={8}>
        <Card sx={{ width: '100%' }}>
          <CardContent>
            <Typography variant="h5" component="h1" gutterBottom>
              Log in
            </Typography>
            {successMessage && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {successMessage}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Box component="form" onSubmit={handleSubmit} noValidate>
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
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                required
                margin="normal"
                autoComplete="current-password"
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={isSubmitting}
                sx={{ mt: 2 }}
              >
                {isSubmitting ? <CircularProgress size={24} /> : 'Log in'}
              </Button>
            </Box>
            <Typography variant="body2" sx={{ mt: 2 }}>
              Don&apos;t have an account?{' '}
              <Link component={RouterLink} to="/register">
                Register
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/pages/LoginPage.tsx`.

---

### Task 7: `RegisterPage`

**Files:**
- Create: `app/client/src/utils/passwordPolicy.ts`
- Create: `app/client/src/pages/RegisterPage.tsx`

**Interfaces:**
- Consumes: `registerRequest` from `src/api/auth.ts` (Task 3); `getErrorMessage` from `src/api/errors.ts` (Task 3).
- Produces: `validatePassword(password: string): string | null` (returns an error message, or `null` if the password satisfies the policy); default export `RegisterPage`, a zero-prop component mounted at route `/register`.

- [ ] **Step 1: Write `src/utils/passwordPolicy.ts`**

```ts
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include a digit.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include a symbol.';
  }
  return null;
}
```

- [ ] **Step 2: Write `src/pages/RegisterPage.tsx`**

```tsx
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
      <Box display="flex" flexDirection="column" alignItems="center" mt={8}>
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
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/utils/passwordPolicy.ts` or `src/pages/RegisterPage.tsx`.

---

### Task 8: `HomePage`

**Files:**
- Create: `app/client/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: default export `useAuthStore` and named export `useAuthUser` from `src/store/useAuthStore.ts` (Task 4).
- Produces: default export `HomePage`, a zero-prop component mounted at route `/` (inside `ProtectedRoute`).

- [ ] **Step 1: Write the implementation**

```tsx
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
      <Box display="flex" flexDirection="column" alignItems="center" mt={8}>
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/pages/HomePage.tsx`.

---

### Task 9: Wire `App.tsx`, remove CRA boilerplate

**Files:**
- Modify: `app/client/src/App.tsx`
- Delete: `app/client/src/App.css`
- `app/client/src/App.test.tsx` is **not touched** — see Global Constraints (frontend tests out of scope).

**Interfaces:**
- Consumes: `LoginPage` (Task 6), `RegisterPage` (Task 7), `HomePage` (Task 8), `ProtectedRoute`/`PublicOnlyRoute` (Task 5), `BrowserRouter`/`Routes`/`Route`/`Navigate` from `react-router-dom` (Task 1).
- Produces: default export `App`, the root component (unchanged export shape from before this plan — still rendered by `src/index.tsx`, which is not modified).

- [ ] **Step 1: Rewrite `src/App.tsx`**

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import ProtectedRoute from './routes/ProtectedRoute';
import PublicOnlyRoute from './routes/PublicOnlyRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 2: Delete `src/App.css`**

Run: `rm app/client/src/App.css` (from the repo root) — its rules (`.App-logo`, `.App-header`, spin keyframes) styled markup that no longer exists, and the new `App.tsx` does not import it.

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p .` (from `app/client/`)
Expected: no errors mentioning `src/App.tsx`. (`src/App.test.tsx` is untouched and not part of this verification.)

---

### Task 10: Full build verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: all files from Tasks 1–9.

- [ ] **Step 1: Run the production build**

Run from `app/client/`:

```bash
npm run build
```

Expected: build succeeds with no TypeScript or bundling errors (warnings are acceptable; errors are not).

- [ ] **Step 2: Report remaining manual step to the user**

State clearly that manual, in-browser verification (`npm start` against a real `REACT_APP_API_BASE_URL` in `app/client/.env`, exercising register → login → home → logout) has **not** been performed by the assistant and is left to the user, per the spec's Testing/verification section.

---

## Self-Review Notes

- **Spec coverage:** every Decisions/Components entry in the spec maps to a task — dependency (Task 1), JWT decode (Task 2), API + error helper (Task 3), store incl. expiry check (Task 4), guards (Task 5), Login/Register/Home pages (Tasks 6–8), App wiring + CSS cleanup (Task 9), build verification (Task 10). `App.test.tsx` is deliberately absent from every task, matching the spec's explicit exclusion.
- **No placeholders:** every step has literal, complete code — nothing deferred to "later" or described without a code block.
- **Type consistency checked:** `setSession({ idToken, accessToken, refreshToken })` (Task 4) matches the call sites in `LoginPage` (Task 6, via `loginRequest`'s `LoginResponse` shape from Task 3 — same three fields plus `expiresIn`, which `setSession` doesn't need and simply isn't passed since `loginRequest`'s return is spread by field name, not positionally). `useAuthUser()`'s `AuthUser` shape (`email`/`name`/`role`, all `string | null`) matches its only two consumers, `LoginPage` (not used there) and `HomePage` (Task 8), which reads `user?.name`/`user?.email`. `getErrorMessage` (Task 3) is imported identically in `LoginPage` and `RegisterPage`.

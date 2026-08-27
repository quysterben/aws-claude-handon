# Client Auth Screens — Design

**Status:** Approved by user, ready for implementation planning.

## Goal

Add Login, Register, and Home (post-login) screens to `app/client`, wired to the existing backend auth API (`POST /auth/register`, `POST /auth/login` — see `docs/superpowers/specs/2026-08-26-cognito-auth-register-login-design.md`). This is the first real feature built on top of the CRA scaffold's pre-wired infrastructure (`src/api/client.ts` axios instance, `src/store/useAppStore.ts` zustand pattern, `src/theme/theme.ts` MUI theme) — none of which has been consumed by an actual screen yet.

## Context

- `app/client` is CRA (React 19, TypeScript, `react-scripts` 5.0.1) with `axios`, `zustand`, and `@mui/material`/`@emotion/*` already in `package.json`, but:
  - `src/App.tsx` is still the unmodified CRA default (logo + "Learn React" link).
  - `src/theme/theme.ts` (`createTheme()`) is wired into `ThemeProvider`/`CssBaseline` in `src/index.tsx`, but no component uses theme-aware styling meaningfully yet since there's no real UI.
  - `src/store/useAppStore.ts` is an explicit placeholder ("Sample store showing the zustand pattern... Replace with real feature stores as functionality is added.") — not meant to hold auth state itself.
  - `src/api/client.ts` exports a configured `axios` instance (`baseURL: process.env.REACT_APP_API_BASE_URL`) — no request-making code exists yet.
  - No routing library is installed.
  - `.env.example` documents `REACT_APP_API_BASE_URL` as the one variable a developer must set locally (pointed at the deployed API Gateway URL).
- Backend contract (`app/api/lambda/auth-register.ts`, `app/api/lambda/auth-login.ts`), already implemented and unaffected by this change:
  - `POST /auth/register` — body `{ email, password, name }`. `201` → `{ id, email, name, role }` (no tokens). `409` if email taken. `400` for missing fields or a password failing Cognito's policy, with message `"password does not meet the required policy (min 8 characters, with uppercase, lowercase, a digit, and a symbol)"`. `500` on other failures.
  - `POST /auth/login` — body `{ email, password }`. `200` → `{ idToken, accessToken, refreshToken, expiresIn }`. `401` with `{ message: "invalid email or password" }` for bad credentials (register/login don't distinguish unknown-user from wrong-password). `400` for missing fields. `500` on other failures.
  - All error responses share the shape `{ message: string }` (`lambda/helpers/http.ts`'s `jsonResponse`).
  - Login never returns a user profile — only tokens. The Cognito `idToken` (a JWT) carries `email`, `name`, and `custom:role` as claims (set at registration via `UserAttributes`), since those are exactly what `AdminCreateUserCommand` wrote onto the Cognito user.

## Decisions

- **Screens in scope: Login, Register, Home.** Home is a minimal authenticated landing page (welcome message + user info + Logout) — confirmed with the user as in-scope alongside Login/Register, rather than deferring it.
- **Routing via `react-router-dom`** (new dependency), not manual state-based screen switching. Chosen over a state-based approach for standard SPA URL semantics (`/login`, `/register`, `/`) and back/forward support, and because it's the conventional choice a future contributor would expect — confirmed with the user over the no-new-dependency alternative.
- **Session persistence via zustand + its `persist` middleware into `localStorage`**, in a new `useAuthStore`, not the existing `useAppStore` (which stays the generic/sample store per its own doc comment). Chosen over in-memory-only state so a page reload doesn't force re-login — confirmed with the user.
- **No user-profile endpoint exists**, so Home's displayed identity (email/name) is read by decoding the `idToken` JWT payload client-side (base64url, no signature verification needed — this is a UI display concern, not an authorization decision; the backend never trusts anything the client claims). A tiny local `decodeJwtPayload` helper is used instead of adding a `jwt-decode` dependency, since the need is a single-purpose base64url decode.
- **Register does not auto-login.** Consistent with the backend (register returns a profile, not tokens): on success, `RegisterPage` navigates to `/login` and passes a success message via router location state (e.g. "Registration successful — please log in"), rendered as an MUI `Alert` on `LoginPage`. This avoids a second, redundant login-shaped code path inside `RegisterPage`.
- **All API error messages are shown as-is from the backend's `{ message }` body** (via MUI `Alert severity="error"`), not re-worded client-side, so the two stay in sync without duplicating copy. A generic fallback ("Something went wrong. Please try again.") is shown only when the response has no parseable `message` (e.g. network failure, 5xx from infra rather than the Lambda).
- **Client-side register validation mirrors the backend's password policy** (min 8 chars, at least one uppercase, one lowercase, one digit, one symbol) so the user gets immediate feedback before submitting, rather than waiting on a round-trip 400. The backend remains the source of truth — this is a UX optimization, not a replacement for server-side validation.
- **All UI built with MUI** (`TextField`, `Button`, `Alert`, `Card`/`CardContent`, `Typography`, `Box`/`Container`, `CircularProgress`), using the existing `theme.ts`/`ThemeProvider` already wired in `index.tsx`. No other UI/CSS library is introduced; `App.css`'s CRA boilerplate rules are removed since `App.tsx`'s CRA markup goes away.
- **Loading state is local to each form** (`useState` inside `LoginPage`/`RegisterPage`), not routed through the existing `useAppStore.isLoading`, since that store is a generic sample and a submit-in-flight flag is specific to one form at a time.
- **Route guarding:** a single `ProtectedRoute` wrapper redirects to `/login` when `useAuthStore` has no session; `/login` and `/register` redirect to `/` when a session already exists (so a logged-in user can't navigate back into the auth forms).
- **`isAuthenticated` also checks token expiry, not just presence.** No backend endpoint exists to verify a token server-side (see Out of scope), so this stays a client-side-only check: `useIsAuthenticated()` decodes the `idToken`'s `exp` claim (seconds since epoch) and treats the session as invalid once `exp * 1000 <= Date.now()`, in addition to requiring `idToken` to be non-null. This is a deliberate, lightweight improvement over presence-only checking — confirmed with the user — so a stale token past its Cognito-issued lifetime (~1 hour) doesn't leave `ProtectedRoute` admitting the user into `/` on a lie. It does not replace real server-side verification (there is nothing to verify against yet); it only prevents the client from trusting an expired token it already knows is expired.
- **Frontend test files are not developed, modified, or executed as part of this work**, per explicit user instruction — this overrides the general "keep existing tests valid" instinct. The pre-existing `src/App.test.tsx` (which asserts CRA's default "Learn React" link) is left completely untouched, even though it will no longer reflect `App.tsx`'s actual behavior once this feature lands. `npm test` is never run. Verification is `npm run build` only (a type-check + production bundle, not a test run).

## Components

### New dependency (`app/client/package.json`)

- `react-router-dom` (latest compatible with React 19).

### `src/api/auth.ts` (new)

- `registerRequest(input: { email: string; password: string; name: string }): Promise<{ id: string; email: string; name: string; role: string }>` — `apiClient.post('/auth/register', input)`.
- `loginRequest(input: { email: string; password: string }): Promise<{ idToken: string; accessToken: string; refreshToken: string; expiresIn: number }>` — `apiClient.post('/auth/login', input)`.
- Both let axios errors propagate; callers extract `error.response?.data?.message`.

### `src/utils/jwt.ts` (new)

- `decodeJwtPayload<T>(token: string): T | null` — splits on `.`, base64url-decodes the middle segment, `JSON.parse`s it; returns `null` on any failure (malformed token). No signature verification (display-only use).

### `src/store/useAuthStore.ts` (new)

- Zustand store created with `persist` (key `auth-storage`, `localStorage`).
- State: `idToken: string | null`, `accessToken: string | null`, `refreshToken: string | null`, all initialized `null`.
- Derived-on-read (not persisted): `isAuthenticated` — a selector (`useIsAuthenticated()`) that requires `idToken` to be non-null **and** its decoded `exp` claim to still be in the future, rather than a duplicated persisted flag or a presence-only check.
- Actions: `setSession({ idToken, accessToken, refreshToken })`, `logout()` (resets all three to `null`).
- A separate selector/helper `useAuthUser()` decodes `idToken` via `decodeJwtPayload` and returns `{ email, name, role } | null` for display purposes — computed on read, not stored, so it's always in sync with the current token.

### `src/routes/ProtectedRoute.tsx` (new)

- Reads `isAuthenticated` from `useAuthStore`; renders `children` (or `<Outlet />`) if true, else `<Navigate to="/login" replace />`.

### `src/routes/PublicOnlyRoute.tsx` (new)

- Inverse guard for `/login` and `/register`: if `isAuthenticated`, `<Navigate to="/" replace />`; else renders the route.

### `src/pages/LoginPage.tsx` (new)

- MUI form: email + password `TextField`s, submit `Button` (disabled + `CircularProgress` while submitting).
- Reads an optional success message from `location.state` (set by `RegisterPage` on redirect) and shows it in an `Alert severity="success"` above the form.
- On submit: `loginRequest` → on success `setSession(...)` then `navigate('/')`; on failure, show `Alert severity="error"` with the backend's `message` (falls back to a generic message if absent).
- Link to `/register` ("Don't have an account? Register").

### `src/pages/RegisterPage.tsx` (new)

- MUI form: name, email, password `TextField`s, submit `Button`.
- Client-side validation: required fields; password checked against the same policy the backend enforces (min 8 chars, upper, lower, digit, symbol), shown as `TextField` `helperText`/`error` before submit.
- On submit: `registerRequest` → on success, `navigate('/login', { state: { message: 'Registration successful — please log in.' } })`; on failure (e.g. 409 duplicate email, 400 policy violation from a race with client-side validation), show `Alert severity="error"` with the backend's `message`.
- Link to `/login` ("Already have an account? Log in").

### `src/pages/HomePage.tsx` (new)

- Reads user info via `useAuthUser()` (email/name from the decoded `idToken`); shows a welcome message ("Welcome, {name}").
- Logout `Button` → `useAuthStore().logout()` → `navigate('/login', { replace: true })`.

### `src/App.tsx` (modified)

- Removes the CRA default markup (logo, "Learn React" link) entirely.
- Renders `BrowserRouter` → `Routes`: `/login` and `/register` each wrapped in `PublicOnlyRoute`; `/` wrapped in `ProtectedRoute` rendering `HomePage`; a catch-all (`*`) redirecting to `/`.
- `ThemeProvider`/`CssBaseline` stay in `src/index.tsx` as-is (already correctly wired) — not duplicated in `App.tsx`.

### `src/App.css` (modified)

- CRA boilerplate rules (`.App-logo`, `.App-header`, spin keyframes) removed since the markup they styled no longer exists. `App.css`'s import in `App.tsx` is dropped, or the file is emptied — whichever leaves no dead CSS.

### `src/App.test.tsx` (not touched)

- Left as-is. Per user instruction, frontend test files are out of scope for both development and execution in this work — this file is neither corrected to match the new `App.tsx` nor run. It will assert stale ("Learn React" link) content that no longer exists once this feature lands; that inconsistency is accepted, not fixed, here.

### `.env.example`

- No value changes; already documents the one required variable (`REACT_APP_API_BASE_URL`). No edit needed unless a comment is judged worth adding during implementation.

## Data flow

1. **Register:** `RegisterPage` form → client-side password-policy check → `registerRequest` → `POST /auth/register` → on `201`, navigate to `/login` with a success message in route state (no session created yet — register never returns tokens).
2. **Login:** `LoginPage` form → `loginRequest` → `POST /auth/login` → on `200`, `useAuthStore.setSession(tokens)` (persisted to `localStorage` by the `persist` middleware) → navigate to `/`.
3. **Home:** `ProtectedRoute` confirms `isAuthenticated` (derived from `idToken` presence **and** an unexpired `exp` claim) → `HomePage` decodes `idToken` client-side for display → Logout clears the store and returns to `/login`.
4. **Reload:** zustand's `persist` middleware rehydrates `idToken`/`accessToken`/`refreshToken` from `localStorage` on store creation, so `isAuthenticated` is correct immediately without a round-trip to the backend.

## Error handling

- **Network/infra failure (no response, or a response with no `message` field):** a generic fallback message is shown; the raw axios error is not surfaced to the UI.
- **400 (validation) on register/login:** shown verbatim from `message` — this is what carries the exact password-policy wording from the backend if client-side validation is somehow bypassed or falls out of sync with the backend's actual policy.
- **409 (duplicate email) on register:** shown verbatim ("email is already registered").
- **401 (bad credentials) on login:** shown verbatim ("invalid email or password") — no client-side attempt to distinguish unknown-email from wrong-password, matching the backend's intentional non-disclosure.
- **Malformed/missing `idToken` on Home** (should not happen if `ProtectedRoute` and `setSession` are both correct, but decoding is defensive): `useAuthUser()` returns `null` on decode failure; `HomePage` falls back to a generic "Welcome" without a name rather than crashing.
- **Expired `idToken` still in `localStorage`** (e.g. user leaves the tab open past the token's lifetime): `useIsAuthenticated()`'s `exp` check catches this on the next render/navigation and `ProtectedRoute` redirects to `/login` — the stale token is left in storage as-is (not actively cleared); a subsequent successful login overwrites it via `setSession`.

## Testing / verification

- `npm run build` (from `app/client/`) after implementation, to type-check the new TypeScript and confirm the production build succeeds.
- `npm test` is **not** run by the assistant, per existing project convention for `app/client` changes.
- No test files are written, modified, or executed as part of this work, per explicit user instruction (see Decisions and `App.test.tsx` above) — this feature is manually verified by the user running `npm start` against a deployed API (`REACT_APP_API_BASE_URL` set in a local `.env`), not by the assistant, since the assistant does not run the CRA dev server against live AWS resources as part of this task.

## Out of scope

- Token refresh (exchanging `refreshToken` for a new `accessToken`) — no backend endpoint exists for this yet (noted as out of scope in the backend's own design doc). An expired token is detected client-side (see Decisions) but not silently refreshed; the user must log in again.
- A server-side "check auth" / token-verification endpoint (e.g. `GET /auth/me`) — the backend exposes no protected/JWT-authorized route to call for this; `isAuthenticated` is a client-side-only check (presence + expiry) rather than a real server round-trip. Confirmed with the user as acceptable for this scope.
- Attaching `accessToken`/`idToken` to future authenticated API calls (e.g. an `Authorization` header interceptor on `apiClient`) — no protected backend route exists yet for this frontend to call.
- Forgot-password / change-password flows — no backend support.
- Any development, modification, or execution of frontend test files, including the pre-existing `App.test.tsx` — explicitly excluded per user instruction; verification is via `npm run build` (type-check) only.
- Any change to `app/api` — this is a client-only feature built against the already-implemented, unmodified backend auth API.

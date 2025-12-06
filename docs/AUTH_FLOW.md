# APE Archive - Authentication Flow Documentation

## Overview

The authentication system uses a **true BFF (Backend For Frontend) pattern** where:

- **Backend is the ONLY Google OAuth handler** - frontend never talks to Google directly
- Frontend simply redirects to `/auth/google`
- Backend handles all Google interactions internally
- Backend redirects frontend to success URL with access token in URL fragment
- No refresh tokens - users re-authenticate when session expires
- Access tokens stored in localStorage on frontend

---

## Architecture

### BFF Pattern Benefits

1. **Security**: Google client secret never exposed, frontend never sees Google
2. **Simplicity**: Frontend just does one redirect, backend handles everything
3. **Control**: Backend can intercept, log, audit all auth events
4. **Flexibility**: Can swap Google for another provider without frontend changes
5. **Logout**: No token refresh logic - simple localStorage clearing

### Key Principle

**Frontend: `window.location.href = '/auth/google'` → Backend handles all Google interaction internally → Backend redirects frontend to `/dashboard#accessToken=...`**

---

## Google OAuth2 Flow (1 Frontend Step)

### Step 1: User Clicks "Login"

Frontend redirects to backend:

```javascript
// Frontend - that's it!
function loginWithGoogle() {
  window.location.href = "/api/v1/auth/google";
}
```

### Step 2: Backend Redirects to Google (Internal)

```
Frontend → Backend /auth/google (302 redirect) → Google consent screen
```

Backend generates Google auth URL and redirects user.

### Step 3: User Authorizes on Google

User sees: "App wants to access your profile and email"

### Step 4: Google Redirects Back to Backend (Internal)

```
Google → Backend /auth/google/callback?code=... (302 redirect) → Frontend /dashboard#accessToken=...
```

Backend:

1. Receives `code` from Google
2. Exchanges code for Google tokens
3. Verifies Google ID token
4. Gets/creates user in database
5. Generates JWT access token
6. **Redirects frontend to success URL with token in URL fragment**

### Step 5: Frontend Extracts Token

```javascript
// Frontend automatically processes after redirect
const fragment = new URLSearchParams(window.location.hash.substring(1));
const accessToken = fragment.get("accessToken");
const isOnboarded = fragment.get("isOnboarded");

localStorage.setItem("accessToken", accessToken);

// Redirect to onboard if needed
if (isOnboarded === "false") {
  window.location.href = "/onboard";
}
```

---

## API Endpoints

### Login Entry Point

**Endpoint:**

```
GET /api/v1/auth/google
```

**What it does:**

- Generates Google auth URL
- Redirects user to Google (HTTP 302)

**Frontend Usage:**

```javascript
// Just redirect to this
window.location.href = "/api/v1/auth/google";
```

### Google Callback (Internal - NOT for frontend)

**Endpoint:**

```
GET /api/v1/auth/google/callback?code=...&state=...
```

**What it does:**

- Receives redirect from Google after user authorizes
- Exchanges code for tokens
- Creates/finds user in database
- Generates JWT access token
- Redirects frontend to success URL with token in fragment

**Response (HTTP 302 Redirect):**

```
Location: http://localhost:3001/dashboard#accessToken=eyJhbGciOiJIUzI1NiIs...&userId=uuid-...&isOnboarded=true
```

---

## Access Token Management

### Storage

Frontend extracts token from URL fragment and stores in localStorage:

```javascript
const fragment = new URLSearchParams(window.location.hash.substring(1));
const accessToken = fragment.get("accessToken");
localStorage.setItem("accessToken", accessToken);
```

### Usage

Include token in all authenticated requests:

```javascript
const headers = {
  Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
};

// Example: Get current user profile
const response = await fetch("/api/v1/auth/me", { headers });
```

### Token Validation

Backend validates token on every authenticated endpoint using `isAuthenticated` middleware.

---

## Logout Flow

Frontend logout - just clear localStorage:

```javascript
function logout() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("user");

  // Redirect to login
  window.location.href = "/login";
}
```

**Why no refresh token?**

- Session-based: Access token is short-lived
- Re-authentication: User logs in again when token expires
- Simpler: No token rotation logic
- More secure: No long-lived refresh tokens to compromise

---

## Authenticated Endpoints

### Get Current User - GET `/api/v1/auth/me`

**Request:**

```bash
GET /api/v1/auth/me
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "GUEST",
    "imageUrl": "https://...",
    "isOnboarded": false,
    "createdAt": "2025-12-06T10:00:00Z"
  },
  "message": "User profile retrieved successfully"
}
```

### Onboard User - POST `/api/v1/auth/onboard`

Complete user onboarding by setting role and profile details.

**Request:**

```bash
POST /api/v1/auth/onboard
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "role": "STUDENT",
  "school": "Central High School",
  "batch": "2025",
  "interests": ["tag-id-1", "tag-id-2"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "STUDENT",
    "isOnboarded": true,
    "imageUrl": "https://..."
  },
  "message": "User onboarded successfully"
}
```

---

## Environment Variables

### Required

```env
# Backend
PORT=3000
DATABASE_URL=postgresql://...

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Console>
GOOGLE_CLIENT_SECRET=<from Google Console>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback

# Frontend URLs
FRONTEND_URL=http://localhost:3001
FRONTEND_SUCCESS_URL=http://localhost:3001/dashboard

# JWT
JWT_SECRET=<secure-random-string>

# Google Drive (for resource uploads)
GOOGLE_REFRESH_TOKEN=<admin refresh token>
ROOT_FOLDER_ID=<source hierarchy folder>
UPLOAD_FOLDER_ID=<flat destination folder>
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    /* response data */
  },
  "message": "Description of what happened"
}
```

### Error Response

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400
}
```

---

## Error Handling

### Common Errors

| Status | Error                                    | Cause                                   |
| ------ | ---------------------------------------- | --------------------------------------- |
| 400    | `Google authorization failed: ...`       | User denied access or error from Google |
| 400    | `Missing authorization code`             | Google didn't send code                 |
| 400    | `Email not found in Google token`        | Google account missing email            |
| 401    | `Unauthorized`                           | Missing or invalid access token         |
| 401    | `User not found`                         | User deleted from database              |
| 403    | `Forbidden`                              | User lacks required role                |
| 500    | `Failed to process Google authorization` | Backend error                           |

---

## Frontend Integration Example

### Login Page

```javascript
export function LoginPage() {
  const handleGoogleLogin = () => {
    // One line - that's it!
    window.location.href = "/api/v1/auth/google";
  };

  return <button onClick={handleGoogleLogin}>Login with Google</button>;
}
```

### Success Page (After Redirect)

```javascript
export function DashboardPage() {
  useEffect(() => {
    // Process login on mount
    const processLogin = () => {
      // Extract token from URL fragment
      const fragment = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = fragment.get("accessToken");
      const isOnboarded = fragment.get("isOnboarded");

      if (!accessToken) return;

      // Store token
      localStorage.setItem("accessToken", accessToken);

      // Clean up URL
      window.history.replaceState({}, document.title, "/dashboard");

      // Redirect to onboard if needed
      if (isOnboarded === "false") {
        window.location.href = "/onboard";
      }
    };

    processLogin();
  }, []);

  return <div>Welcome to Dashboard!</div>;
}
```

### Protected Route

```javascript
export function ProtectedRoute({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        if (!token) {
          setIsAuthenticated(false);
          return;
        }

        // Verify token is still valid
        const response = await fetch("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("accessToken");
          setIsAuthenticated(false);
        }
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;

  return children;
}
```

### Logout

```javascript
export function LogoutButton() {
  const handleLogout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  return <button onClick={handleLogout}>Logout</button>;
}
```

---

## Security Considerations

### 1. URL Fragment vs Query String

✅ **Use URL fragment (#)** for tokens - not sent to server in HTTP headers

```
Good:  http://localhost:3001/dashboard#accessToken=...
Bad:   http://localhost:3001/dashboard?accessToken=...
```

### 2. HTTPS Only (Production)

In production, ensure:

- HTTPS enforced
- Secure cookie flag if using cookies
- SameSite policy configured

### 3. CORS Configuration

Backend CORS should only allow frontend domain:

```typescript
cors: {
  origin: process.env.FRONTEND_URL,
  credentials: true,
}
```

### 4. Clean URL After Extraction

Remove token from URL after extracting:

```javascript
window.history.replaceState({}, document.title, "/dashboard");
```

---

## Summary

| Aspect            | Detail                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| **Pattern**       | BFF (Backend For Frontend)                                                                  |
| **Flow**          | Frontend redirects → Backend handles Google → Backend redirects to frontend with token      |
| **Token Type**    | JWT (Backend-issued)                                                                        |
| **Storage**       | localStorage (access token in URL fragment)                                                 |
| **Refresh**       | No refresh token - re-authenticate when expired                                             |
| **Logout**        | Clear localStorage                                                                          |
| **Endpoints**     | `GET /auth/google` (redirects) → `GET /auth/google/callback` (internal) → Token in fragment |
| **Frontend Code** | ~50 lines total (login + processing + protected routes)                                     |

---

## Related Documentation

- [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) - Resource endpoints
- [MIGRATION_TO_TAGS.md](./MIGRATION_TO_TAGS.md) - Tag system architecture

### Step 1: Redirect to Google - GET `/api/v1/auth/google`

Frontend redirects user to this endpoint. Backend immediately redirects to Google OAuth consent screen.

**Request:**

```bash
# Frontend simply redirects to this
window.location.href = '/api/v1/auth/google';
```

**What Backend Does:**

1. Generates Google OAuth URL
2. Sets HTTP 302 redirect response
3. User is redirected to Google consent screen

**Google Consent Screen:**

- User sees "App wants to access your profile and email"
- After authorizing, Google redirects back to: `http://localhost:3000/api/v1/auth/callback?code=<CODE>&state=<STATE>`

---

### Step 2: Handle Callback - POST `/api/v1/auth/callback`

After user authorizes on Google, frontend extracts the `code` from the redirect URL and sends it to backend.

**Request:**

```bash
POST /api/v1/auth/callback
Content-Type: application/json

{
  "code": "4/0AdY47clK..."
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-...",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "GUEST",
      "imageUrl": "https://...",
      "isOnboarded": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "Login successful"
}
```

**What Backend Does:**

1. Receives authorization code
2. Exchanges code for Google tokens (access token + ID token)
3. Verifies Google ID token to get user info
4. Finds or creates user in database
5. Generates backend JWT access token
6. Returns user data and access token

**Frontend Usage:**

```javascript
// Extract code from URL
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

// Send to backend
const response = await fetch("/api/v1/auth/callback", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code }),
});

const { data } = await response.json();

// Store access token in localStorage
localStorage.setItem("accessToken", data.accessToken);

// Store user data (optional)
localStorage.setItem("user", JSON.stringify(data.user));

// Redirect to dashboard or onboarding
window.location.href = data.user.isOnboarded ? "/dashboard" : "/onboard";
```

---

## Access Token Management

### Storage

**Frontend stores only the JWT access token in localStorage:**

```javascript
localStorage.setItem("accessToken", data.accessToken);
```

### Usage

**Include token in all authenticated requests:**

```javascript
const headers = {
  Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
};

// Example: Get current user profile
const response = await fetch("/api/v1/auth/me", { headers });
```

### Token Validation

Backend validates token on every authenticated endpoint using `isAuthenticated` middleware:

```typescript
// Middleware validates JWT and attaches user to request
export const isAuthenticated = async ({ headers, set, ...request }: any) => {
  const token = headers.authorization?.replace("Bearer ", "");
  if (!token) {
    set.status = 401;
    throw new UnauthorizedError("Missing access token");
  }
  // Token is verified and user attached to request.user
};
```

---

## Logout Flow

### Frontend Logout

Simple - just clear localStorage:

```javascript
function logout() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("user");

  // Redirect to login
  window.location.href = "/login";
}
```

### Why No Refresh Token?

- **Session-based**: Access token is short-lived (default JWT expiry)
- **Re-authentication**: User logs in again when token expires
- **Simpler**: No token rotation logic needed
- **More secure**: No long-lived refresh tokens to compromise

---

## Authenticated Endpoints

### Get Current User - GET `/api/v1/auth/me`

**Request:**

```bash
GET /api/v1/auth/me
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "GUEST",
    "imageUrl": "https://...",
    "isOnboarded": false,
    "createdAt": "2025-12-06T10:00:00Z"
  },
  "message": "User profile retrieved successfully"
}
```

---

### Onboard User - POST `/api/v1/auth/onboard`

Complete user onboarding by setting role and profile details.

**Request:**

```bash
POST /api/v1/auth/onboard
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "role": "STUDENT",
  "school": "Central High School",
  "batch": "2025",
  "interests": ["tag-id-1", "tag-id-2"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "STUDENT",
    "isOnboarded": true,
    "imageUrl": "https://..."
  },
  "message": "User onboarded successfully"
}
```

**Roles:**

- `STUDENT`: Student using resources
- `TEACHER`: Teacher uploading resources

---

## Environment Variables

### Required

```env
# Backend
PORT=3000
DATABASE_URL=postgresql://...

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Console>
GOOGLE_CLIENT_SECRET=<from Google Console>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/callback

# Frontend URL (for redirects)
FRONTEND_URL=http://localhost:3001

# JWT
JWT_SECRET=<secure-random-string>

# Google Drive (for resource uploads)
GOOGLE_REFRESH_TOKEN=<admin refresh token>
ROOT_FOLDER_ID=<source hierarchy folder>
UPLOAD_FOLDER_ID=<flat destination folder>
```

---

## Response Format

### Success Response

All successful responses follow this format:

```json
{
  "success": true,
  "data": {
    /* response data */
  },
  "message": "Description of what happened"
}
```

### Error Response

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400
}
```

---

## Error Handling

### Common Errors

| Status | Error                                   | Cause                           |
| ------ | --------------------------------------- | ------------------------------- |
| 400    | `Invalid authorization code`            | Code expired or invalid         |
| 400    | `Email not found in Google token`       | Google account missing email    |
| 401    | `Unauthorized`                          | Missing or invalid access token |
| 401    | `User not found`                        | User deleted from database      |
| 403    | `Forbidden`                             | User lacks required role        |
| 500    | `Failed to exchange authorization code` | Google API error                |

---

## Frontend Integration Example

### Login Page

```javascript
export function LoginPage() {
  const handleGoogleLogin = () => {
    // Simply redirect to backend - backend handles the rest
    window.location.href = "/api/v1/auth/google";
  };

  return <button onClick={handleGoogleLogin}>Login with Google</button>;
}
```

### Callback Handler (After Google Redirects Back)

When Google redirects back to your app with `?code=...`, extract and send to backend:

```javascript
export function CallbackPage() {
  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Extract code from URL
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (!code) {
          throw new Error("Authorization code not found");
        }

        // Send code to backend to exchange for token
        const response = await fetch("/api/v1/auth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) throw new Error("Authentication failed");

        const { data } = await response.json();

        // Store token
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("user", JSON.stringify(data.user));

        // Redirect based on onboarding status
        if (data.user.isOnboarded) {
          window.location.href = "/dashboard";
        } else {
          window.location.href = "/onboard";
        }
      } catch (error) {
        console.error("Callback failed:", error);
        window.location.href = "/login?error=callback_failed";
      }
    };

    handleCallback();
  }, []);

  return <div>Processing login...</div>;
}
```

### Protected Route

```javascript
export function ProtectedRoute({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        if (!token) {
          setIsAuthenticated(false);
          return;
        }

        // Verify token is still valid
        const response = await fetch("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const { data } = await response.json();
          setUser(data);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("accessToken");
          setIsAuthenticated(false);
        }
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;

  return children;
}
```

### Logout

```javascript
function logout() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("user");
  window.location.href = "/login";
}
```

---

## Security Considerations

### 1. Token Storage

✅ **Access token in localStorage** - Frontend only

- Simple and effective for web apps
- Lost on browser close if needed (implement with session storage)
- Clear on logout

❌ **Never store sensitive data client-side** except access token

### 2. HTTPS Only

```javascript
// In production, only send token over HTTPS
if (process.env.NODE_ENV === "production") {
  localStorage.setItem("accessToken", token);
  // Browser automatically includes token only over HTTPS if Secure flag set
}
```

### 3. CORS

Backend CORS config should only allow frontend domain:

```typescript
cors: {
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}
```

### 4. Authorization Header

Always use Bearer token format:

```javascript
headers: {
  'Authorization': `Bearer ${token}`
}
```

---

## Summary

| Aspect         | Detail                                            |
| -------------- | ------------------------------------------------- |
| **Flow**       | Backend-first Google OAuth2                       |
| **Token Type** | JWT (Backend-issued)                              |
| **Storage**    | localStorage (access token only)                  |
| **Refresh**    | No refresh token - re-authenticate when expired   |
| **Logout**     | Clear localStorage                                |
| **Endpoints**  | GET /auth/google → GET /auth/callback → JWT token |

---

## Related Documentation

- [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) - Resource endpoints
- [MIGRATION_TO_TAGS.md](./MIGRATION_TO_TAGS.md) - Tag system architecture

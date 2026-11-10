# Running on Replit

The project keeps its existing split structure:

- `frontend/`: React, TypeScript, and Vite
- `backend/`: Express API, PostgreSQL, and Redis/BullMQ workers

Use the **Start application** workflow. It runs `scripts/start-replit.sh`, which:

1. starts a local Redis server,
2. starts the backend on port 3000 using Replit's managed `DATABASE_URL`,
3. starts Vite on port 5000 for the Replit preview.

The frontend calls the backend through Vite's same-origin `/api` proxy.

`SESSION_SECRET` is used to derive separate development JWT signing keys when
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are not set.

Public signup is disabled by default in the hosted workflow. Set
`INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD_MIN_12_CHARS` as Replit
Secrets to
create the initial administrator. The backend creates that account once and
leaves it unchanged on later starts. Set `ALLOW_PUBLIC_SIGNUP=true` only when
public account creation is intentionally required.

Optional integrations are disabled until their secrets are configured:
OpenAI, Wasender, RapidAPI Booking/Airbnb, Hotelbeds, and Cloudinary.
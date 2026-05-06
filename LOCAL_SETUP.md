# Local Buzzer Setup (Frontend + Local Supabase)

## 1) Start Supabase (Docker)

From `buzzer-app/supabase`:

```bash
docker network inspect npm_default >/dev/null 2>&1 || docker network create npm_default
docker compose up -d
```

If you changed bootstrap SQL and want a clean DB init:

```bash
docker compose down -v
docker compose up -d
```

## 2) Verify services

```bash
docker compose ps
curl -I http://localhost:54321
curl -I http://localhost:54323
```

Expected:
- REST (`54321`) returns `200` or `401` depending on route
- Studio (`54323`) returns redirect/200

## 3) SQL migrations

Migrations run automatically through the `migrate` service when the Docker stack starts. The service also repairs the internal PostgREST role password so REST can reconnect after container recreation.

## 4) Serve static frontend

From `buzzer-app/web`:

```bash
python3 -m http.server 8080
```

Open:
- Player page: `http://localhost:8080/index.html`
- Admin page: `http://localhost:8080/admin.html`

## 5) Demo credentials

Defined in SQL migration:
- `p1 / p1pass`
- `p2 / p2pass`
- `p3 / p3pass`
- `p4 / p4pass`
- `p5 / p5pass`
- `p6 / p6pass`
- Admin reset password: `adminpass`

## Notes

- This is intentionally simple and local-only.
- Buzz is atomic because it uses one conditional SQL UPDATE on one authoritative row.
- No custom backend server is used.

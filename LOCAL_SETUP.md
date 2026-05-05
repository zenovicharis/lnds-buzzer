# Local Buzzer Setup (Frontend + Local Supabase)

## 1) Start Supabase (Docker)

From `buzzer-app/supabase`:

```bash
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

## 3) Run SQL migrations

From `buzzer-app/supabase`:

```bash
docker exec -i supabase_db psql -U postgres -d postgres < migrations/001_buzzer_schema.sql
docker exec -i supabase_db psql -U postgres -d postgres < migrations/002_buzzer_realtime_rls.sql
docker exec -i supabase_db env PGPASSWORD=postgres psql -U supabase_admin -d postgres < migrations/003_realtime_localhost_tenant.sql
docker exec -i supabase_db psql -U postgres -d postgres < migrations/004_round_history.sql
docker exec -i supabase_db psql -U postgres -d postgres < migrations/005_round_history_rls.sql
```

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

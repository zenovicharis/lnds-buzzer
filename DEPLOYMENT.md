# Deployment Guide

Deploy Supabase on a Contabo server and publish the static web app on Surge.

## Target

- Frontend: `https://YOUR-SURGE-SITE.surge.sh`
- Supabase REST API: `https://api.YOUR-DOMAIN.com`
- Supabase Realtime: `wss://realtime.YOUR-DOMAIN.com`

Use HTTPS/WSS for production. A Surge HTTPS page cannot reliably call plain HTTP or WS endpoints.

## 1. Server Requirements

On the Contabo server, install:

- Docker
- Docker Compose
- Nginx or another reverse proxy
- Certbot or another TLS certificate tool

Open only:

- `22` for SSH
- `80` for HTTP certificate setup
- `443` for HTTPS/WSS traffic

Keep Supabase service ports bound to localhost or blocked by firewall.

## 2. DNS

Create DNS records pointing to the Contabo server:

```txt
api.YOUR-DOMAIN.com       A -> YOUR_CONTABO_IP
realtime.YOUR-DOMAIN.com  A -> YOUR_CONTABO_IP
```

Optional:

```txt
studio.YOUR-DOMAIN.com    A -> YOUR_CONTABO_IP
```

## 3. Supabase Setup

Copy `buzzer-app` to the server.

From the server:

```bash
cd buzzer-app/supabase
docker network inspect npm_default >/dev/null 2>&1 || docker network create npm_default
docker compose up -d
docker compose ps
```

The compose file attaches all services to the external `npm_default` network and runs SQL migrations automatically through the `migrate` service before REST, Realtime, and Studio start.

## 4. Reverse Proxy

Configure your reverse proxy so:

- `https://api.YOUR-DOMAIN.com` proxies to local PostgREST, usually `127.0.0.1:54321`
- `wss://realtime.YOUR-DOMAIN.com` proxies to local Realtime, usually `127.0.0.1:54324`
- WebSocket upgrade headers are enabled for the Realtime route
- TLS certificates are installed for both hostnames

If exposing Studio, put it behind HTTPS and authentication.

## 5. Frontend Config To Adjust

Edit one file:

- `web/script/config.js`

Set:

```js
supabaseUrl: "https://api.YOUR-DOMAIN.com",
```

Set the Realtime URL to:

```js
realtimeUrl: "wss://realtime.YOUR-DOMAIN.com/socket/websocket",
```

The app appends the `apikey` and `vsn` query parameters automatically.

Key values to review before production:

- `supabaseUrl`
- `realtimeUrl`
- Realtime host
- `supabaseAnonKey`
- Profile passwords
- Admin password
- JWT secret in the Supabase Docker environment

## 6. Deploy Static Site To Surge

From your local machine:

```bash
npm install --global surge
cd buzzer-app/web
surge . YOUR-SURGE-SITE.surge.sh
```

Open:

```txt
https://YOUR-SURGE-SITE.surge.sh/index.html
https://YOUR-SURGE-SITE.surge.sh/admin.html
```

## 7. Smoke Test

Check:

- Player page loads from Surge
- Admin page loads from Surge
- Login succeeds with a player profile
- Admin reset creates a new open round
- Player buzz closes the active round
- Other screens update through Realtime

## 8. Backup

Run backups from the server:

```bash
docker exec supabase_db pg_dump -U postgres -d postgres > buzzer-backup.sql
```

Store backups somewhere outside the server.

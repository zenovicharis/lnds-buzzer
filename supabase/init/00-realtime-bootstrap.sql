-- Runs only on first database initialization (empty volume)
create schema if not exists _realtime;

grant usage, create on schema _realtime to supabase_admin;
grant usage on schema public to supabase_admin;

alter role supabase_admin in database postgres
  set search_path = "$user", public, auth, extensions, _realtime;

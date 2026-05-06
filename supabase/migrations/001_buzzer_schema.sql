create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id text primary key,
  display_name text not null,
  password_hash text not null,
  is_admin boolean not null default false
);

create table if not exists public.game_state (
  id integer primary key check (id = 1),
  open boolean not null default true,
  winner_profile_id text references public.profiles(id),
  buzzed_at timestamptz
);

insert into public.profiles (id, display_name, password_hash, is_admin)
values
  ('p1', 'Inderpal', extensions.crypt('p1pass', extensions.gen_salt('bf')), false),
  ('p2', 'AM', extensions.crypt('p2pass', extensions.gen_salt('bf')), false),
  ('p3', 'Kacem', extensions.crypt('p3pass', extensions.gen_salt('bf')), false),
  ('p4', 'Ahmed', extensions.crypt('p4pass', extensions.gen_salt('bf')), false),
  ('p5', 'Rania', extensions.crypt('p5pass', extensions.gen_salt('bf')), false),
  ('p6', 'Emi', extensions.crypt('p6pass', extensions.gen_salt('bf')), false),
  ('admin', 'Admin', extensions.crypt('adminpass', extensions.gen_salt('bf')), true)
on conflict (id) do nothing;

insert into public.game_state (id, open, winner_profile_id, buzzed_at)
values (1, true, null, null)
on conflict (id) do nothing;

create or replace function public.verify_profile_password(
  p_profile_id text,
  p_password text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.password_hash = extensions.crypt(p_password, p.password_hash)
  );
$$;

drop function if exists public.reset_game(text);

create function public.reset_game(
  p_admin_password text
)
returns public.game_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.game_state;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = 'admin'
      and p.is_admin = true
      and p.password_hash = extensions.crypt(p_admin_password, p.password_hash)
  ) then
    return null;
  end if;

  update public.game_state
  set open = true,
      winner_profile_id = null,
      buzzed_at = null
  where id = 1
  returning * into v_row;

  return v_row;
end;
$$;

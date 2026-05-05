create table if not exists public.rounds (
  id text primary key,
  created_at timestamptz not null default clock_timestamp(),
  open boolean not null default true,
  winner_profile_id text references public.profiles(id),
  buzzed_at timestamptz
);

alter table public.game_state
  add column if not exists current_round_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'game_state_current_round_id_fkey'
  ) then
    alter table public.game_state
      add constraint game_state_current_round_id_fkey
      foreign key (current_round_id) references public.rounds(id);
  end if;
end
$$;

create or replace function public.create_round_id()
returns text
language sql
as $$
  select 'round_' || to_char(clock_timestamp() at time zone 'utc', 'YYYYMMDD"T"HH24MISSMS"Z"')
    || '_' || substr(gen_random_uuid()::text, 1, 4);
$$;

do $$
declare
  v_round_id text;
begin
  select current_round_id
  into v_round_id
  from public.game_state
  where id = 1;

  if v_round_id is null then
    select id
    into v_round_id
    from public.rounds
    order by created_at desc
    limit 1;
  end if;

  if v_round_id is null then
    v_round_id := public.create_round_id();

    insert into public.rounds (id, created_at, open)
    values (v_round_id, clock_timestamp(), true);
  end if;

  update public.game_state
  set current_round_id = v_round_id
  where id = 1;
end
$$;

drop function if exists public.reset_game(text);

create function public.reset_game(
  p_admin_password text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.rounds;
  v_previous_round_id text;
  v_round_id text;
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

  select current_round_id
  into v_previous_round_id
  from public.game_state
  where id = 1;

  if v_previous_round_id is not null then
    update public.rounds
    set open = false
    where id = v_previous_round_id
      and open = true;
  end if;

  v_round_id := public.create_round_id();

  insert into public.rounds (id, created_at, open)
  values (v_round_id, clock_timestamp(), true)
  returning * into v_row;

  update public.game_state
  set current_round_id = v_round_id
  where id = 1;

  return v_row;
end;
$$;

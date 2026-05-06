alter table public.rounds
  add column if not exists game_type text not null default 'jeopardy',
  add column if not exists point_value integer not null default 100,
  add column if not exists answer_status text not null default 'buzzing',
  add column if not exists answer_deadline_at timestamptz,
  add column if not exists correct_profile_id text references public.profiles(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rounds_game_type_check'
  ) then
    alter table public.rounds
      add constraint rounds_game_type_check
      check (game_type in ('jeopardy', 'double'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'rounds_point_value_check'
  ) then
    alter table public.rounds
      add constraint rounds_point_value_check
      check (point_value in (100, 200, 500, 1000));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'rounds_answer_status_check'
  ) then
    alter table public.rounds
      add constraint rounds_answer_status_check
      check (answer_status in ('buzzing', 'answering', 'correct', 'closed'));
  end if;
end
$$;

create table if not exists public.scores (
  profile_id text primary key references public.profiles(id),
  total integer not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.round_attempts (
  round_id text not null references public.rounds(id) on delete cascade,
  profile_id text not null references public.profiles(id),
  attempted_at timestamptz not null default clock_timestamp(),
  primary key (round_id, profile_id)
);

insert into public.profiles (id, display_name, password_hash, is_admin)
values
  ('p1', 'Inderpal', extensions.crypt('p1pass', extensions.gen_salt('bf')), false),
  ('p2', 'AM', extensions.crypt('p2pass', extensions.gen_salt('bf')), false),
  ('p3', 'Kacem', extensions.crypt('p3pass', extensions.gen_salt('bf')), false),
  ('p4', 'Ahmed', extensions.crypt('p4pass', extensions.gen_salt('bf')), false),
  ('p5', 'Rania', extensions.crypt('p5pass', extensions.gen_salt('bf')), false),
  ('p6', 'Emi', extensions.crypt('p6pass', extensions.gen_salt('bf')), false)
on conflict (id) do nothing;

insert into public.scores (profile_id, total)
select id, 0
from public.profiles
where is_admin = false
on conflict (profile_id) do nothing;

create or replace function public.is_admin_password(p_admin_password text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = 'admin'
      and p.is_admin = true
      and p.password_hash = extensions.crypt(p_admin_password, p.password_hash)
  );
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
  if not public.is_admin_password(p_admin_password) then
    return null;
  end if;

  select current_round_id
  into v_previous_round_id
  from public.game_state
  where id = 1;

  if v_previous_round_id is not null then
    update public.rounds
    set open = false,
        answer_status = case
          when answer_status = 'correct' then answer_status
          else 'closed'
        end,
        answer_deadline_at = null
    where id = v_previous_round_id
      and open = true;
  end if;

  v_round_id := public.create_round_id();

  insert into public.rounds (id, created_at, open, game_type, point_value, answer_status)
  values (v_round_id, clock_timestamp(), true, 'jeopardy', 100, 'buzzing')
  returning * into v_row;

  update public.game_state
  set current_round_id = v_round_id
  where id = 1;

  return v_row;
end;
$$;

create or replace function public.start_question(
  p_admin_password text,
  p_game_type text,
  p_point_value integer
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
  if not public.is_admin_password(p_admin_password) then
    return null;
  end if;

  if p_game_type not in ('jeopardy', 'double') or p_point_value not in (100, 200, 500, 1000) then
    raise exception 'Invalid question setup';
  end if;

  select current_round_id
  into v_previous_round_id
  from public.game_state
  where id = 1;

  if v_previous_round_id is not null then
    update public.rounds
    set open = false,
        answer_status = case
          when answer_status = 'correct' then answer_status
          else 'closed'
        end,
        answer_deadline_at = null
    where id = v_previous_round_id
      and open = true;
  end if;

  v_round_id := public.create_round_id();

  insert into public.rounds (id, created_at, open, game_type, point_value, answer_status)
  values (v_round_id, clock_timestamp(), true, p_game_type, p_point_value, 'buzzing')
  returning * into v_row;

  update public.game_state
  set current_round_id = v_round_id
  where id = 1;

  return v_row;
end;
$$;

create or replace function public.submit_buzz(
  p_profile_id text,
  p_password text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_row public.rounds;
  v_inserted_attempt boolean;
begin
  if not public.verify_profile_password(p_profile_id, p_password) then
    return null;
  end if;

  select current_round_id
  into v_round_id
  from public.game_state
  where id = 1;

  if v_round_id is null then
    return null;
  end if;

  insert into public.round_attempts (round_id, profile_id)
  select v_round_id, p_profile_id
  where exists (
    select 1
    from public.rounds r
    where r.id = v_round_id
      and r.open = true
      and r.answer_status = 'buzzing'
      and r.winner_profile_id is null
  )
  on conflict do nothing
  returning true into v_inserted_attempt;

  if not coalesce(v_inserted_attempt, false) then
    return null;
  end if;

  update public.rounds
  set open = false,
      winner_profile_id = p_profile_id,
      buzzed_at = clock_timestamp(),
      answer_status = 'answering',
      answer_deadline_at = clock_timestamp() + interval '20 seconds'
  where id = v_round_id
    and open = true
    and answer_status = 'buzzing'
    and winner_profile_id is null
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.release_buzzer(
  p_admin_password text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_row public.rounds;
begin
  if not public.is_admin_password(p_admin_password) then
    return null;
  end if;

  select current_round_id
  into v_round_id
  from public.game_state
  where id = 1;

  update public.rounds
  set open = true,
      winner_profile_id = null,
      buzzed_at = null,
      answer_status = 'buzzing',
      answer_deadline_at = null
  where id = v_round_id
    and answer_status = 'answering'
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.expire_answer_window()
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_row public.rounds;
begin
  select current_round_id
  into v_round_id
  from public.game_state
  where id = 1;

  update public.rounds
  set open = true,
      winner_profile_id = null,
      buzzed_at = null,
      answer_status = 'buzzing',
      answer_deadline_at = null
  where id = v_round_id
    and answer_status = 'answering'
    and answer_deadline_at <= clock_timestamp()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.confirm_correct(
  p_admin_password text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_row public.rounds;
begin
  if not public.is_admin_password(p_admin_password) then
    return null;
  end if;

  select current_round_id
  into v_round_id
  from public.game_state
  where id = 1;

  update public.rounds
  set open = false,
      answer_status = 'correct',
      answer_deadline_at = null,
      correct_profile_id = winner_profile_id
  where id = v_round_id
    and winner_profile_id is not null
    and answer_status = 'answering'
  returning * into v_row;

  if v_row.correct_profile_id is not null then
    insert into public.scores (profile_id, total, updated_at)
    values (v_row.correct_profile_id, v_row.point_value, clock_timestamp())
    on conflict (profile_id) do update
    set total = public.scores.total + excluded.total,
        updated_at = clock_timestamp();
  end if;

  return v_row;
end;
$$;

alter table public.scores enable row level security;
alter table public.round_attempts enable row level security;

drop policy if exists scores_read_all on public.scores;
create policy scores_read_all
on public.scores
for select
using (true);

drop policy if exists round_attempts_no_direct_read on public.round_attempts;
create policy round_attempts_no_direct_read
on public.round_attempts
for select
using (false);

grant select on public.scores to anon, authenticated;
revoke update (open, winner_profile_id, buzzed_at) on public.rounds from anon, authenticated;
grant execute on function public.is_admin_password(text) to anon, authenticated;
grant execute on function public.start_question(text, text, integer) to anon, authenticated;
grant execute on function public.submit_buzz(text, text) to anon, authenticated;
grant execute on function public.release_buzzer(text) to anon, authenticated;
grant execute on function public.expire_answer_window() to anon, authenticated;
grant execute on function public.confirm_correct(text) to anon, authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.scores;
  exception
    when duplicate_object then
      null;
  end;
end
$$;

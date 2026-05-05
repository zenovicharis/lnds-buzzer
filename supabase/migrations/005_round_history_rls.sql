alter table public.rounds enable row level security;

drop policy if exists rounds_read_all on public.rounds;
create policy rounds_read_all
on public.rounds
for select
using (true);

drop policy if exists rounds_buzz_once on public.rounds;
create policy rounds_buzz_once
on public.rounds
for update
to anon
using (
  id = (
    select current_round_id
    from public.game_state
    where id = 1
  )
  and open = true
  and winner_profile_id is null
)
with check (
  open = false
  and winner_profile_id is not null
);

grant select on public.rounds to anon, authenticated;
grant update (open, winner_profile_id, buzzed_at) on public.rounds to anon, authenticated;

grant execute on function public.create_round_id() to anon, authenticated;
grant execute on function public.reset_game(text) to anon, authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.rounds;
  exception
    when duplicate_object then
      null;
  end;
end
$$;
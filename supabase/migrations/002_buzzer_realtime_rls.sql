alter table public.game_state enable row level security;
alter table public.profiles enable row level security;

drop policy if exists game_state_read_all on public.game_state;
create policy game_state_read_all
on public.game_state
for select
using (true);

drop policy if exists profiles_no_direct_read on public.profiles;
create policy profiles_no_direct_read
on public.profiles
for select
using (false);

grant usage on schema public to anon, authenticated;
grant select on public.game_state to anon, authenticated;

grant execute on function public.verify_profile_password(text, text) to anon, authenticated;
grant execute on function public.reset_game(text) to anon, authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.game_state;
  exception
    when duplicate_object then
      null;
  end;
end
$$;

-- Split from 20260418222826: remote `db push` uses one command per prepared statement; multi-statement files fail.
grant execute on function public.approve_inventory_session_atomic(uuid, uuid, uuid, jsonb)
to authenticated;

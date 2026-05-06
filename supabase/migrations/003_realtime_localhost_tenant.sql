insert into _realtime.tenants (
  id,
  name,
  external_id,
  jwt_secret,
  max_concurrent_users,
  inserted_at,
  updated_at,
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha,
  private_only,
  migrations_ran,
  broadcast_adapter,
  max_presence_events_per_second,
  max_payload_size_in_kb,
  max_client_presence_events_per_window,
  client_presence_window_ms
)
select
  gen_random_uuid(),
  'localhost',
  'localhost',
  jwt_secret,
  max_concurrent_users,
  now()::timestamp(0),
  now()::timestamp(0),
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha,
  private_only,
  migrations_ran,
  broadcast_adapter,
  max_presence_events_per_second,
  max_payload_size_in_kb,
  max_client_presence_events_per_window,
  client_presence_window_ms
from _realtime.tenants
where external_id = 'realtime-dev'
on conflict (external_id) do nothing;

insert into _realtime.extensions (
  id,
  type,
  settings,
  tenant_external_id,
  inserted_at,
  updated_at
)
select
  gen_random_uuid(),
  type,
  settings,
  'localhost',
  now()::timestamp(0),
  now()::timestamp(0)
from _realtime.extensions
where tenant_external_id = 'realtime-dev'
on conflict (tenant_external_id, type) do nothing;

insert into _realtime.tenants (
  id,
  name,
  external_id,
  jwt_secret,
  max_concurrent_users,
  inserted_at,
  updated_at,
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha,
  private_only,
  migrations_ran,
  broadcast_adapter,
  max_presence_events_per_second,
  max_payload_size_in_kb,
  max_client_presence_events_per_window,
  client_presence_window_ms
)
select
  gen_random_uuid(),
  'realtime',
  'realtime',
  jwt_secret,
  max_concurrent_users,
  now()::timestamp(0),
  now()::timestamp(0),
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha,
  private_only,
  migrations_ran,
  broadcast_adapter,
  max_presence_events_per_second,
  max_payload_size_in_kb,
  max_client_presence_events_per_window,
  client_presence_window_ms
from _realtime.tenants
where external_id = 'localhost'
on conflict (external_id) do nothing;

insert into _realtime.extensions (
  id,
  type,
  settings,
  tenant_external_id,
  inserted_at,
  updated_at
)
select
  gen_random_uuid(),
  type,
  settings,
  'realtime',
  now()::timestamp(0),
  now()::timestamp(0)
from _realtime.extensions
where tenant_external_id = 'localhost'
on conflict (tenant_external_id, type) do nothing;

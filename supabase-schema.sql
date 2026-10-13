create extension if not exists btree_gist;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  booking_code text not null,
  guest_name text not null check (char_length(guest_name) between 1 and 80),
  phone text not null check (char_length(phone) between 1 and 24),
  email text,
  room_id text not null,
  room_type text not null,
  guests integer not null check (guests between 1 and 4),
  check_in date not null,
  check_out date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'checked-in', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (user_id, booking_code),
  check (check_out > check_in)
);

alter table public.bookings enable row level security;
grant select, insert, update, delete on public.bookings to authenticated;

drop policy if exists "Users can read their own bookings" on public.bookings;
create policy "Users can read their own bookings"
  on public.bookings for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own bookings" on public.bookings;
create policy "Users can create their own bookings"
  on public.bookings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own bookings" on public.bookings;
create policy "Users can update their own bookings"
  on public.bookings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own bookings" on public.bookings;
create policy "Users can delete their own bookings"
  on public.bookings for delete
  to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_no_overlapping_room_stays'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_no_overlapping_room_stays
      exclude using gist (
        user_id with =,
        room_id with =,
        daterange(check_in, check_out, '[)') with &&
      )
      where (status in ('confirmed', 'checked-in'));
  end if;
end;
$$;

create table if not exists public.room_maintenance (
  user_id uuid not null references auth.users (id) on delete cascade,
  room_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table public.room_maintenance enable row level security;
grant select, insert, delete on public.room_maintenance to authenticated;

drop policy if exists "Users can read their own room maintenance" on public.room_maintenance;
create policy "Users can read their own room maintenance"
  on public.room_maintenance for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own room maintenance" on public.room_maintenance;
create policy "Users can add their own room maintenance"
  on public.room_maintenance for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own room maintenance" on public.room_maintenance;
create policy "Users can remove their own room maintenance"
  on public.room_maintenance for delete
  to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_maintenance'
  ) then
    alter publication supabase_realtime add table public.room_maintenance;
  end if;
end;
$$;

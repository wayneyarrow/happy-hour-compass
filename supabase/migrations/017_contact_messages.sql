-- Migration 017: contact_messages table
--
-- Stores messages submitted via the /contact page.

create table if not exists contact_messages (
  id          uuid        primary key default gen_random_uuid(),
  name        text,
  email       text        not null,
  message     text        not null,
  created_at  timestamptz not null default now()
);

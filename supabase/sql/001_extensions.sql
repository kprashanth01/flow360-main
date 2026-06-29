create extension if not exists vector;
create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;


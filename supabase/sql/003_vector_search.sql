create or replace function match_document_chunks(
  query_embedding vector(768),
  match_count int default 8,
  filter_account_id text default null
)
returns table (
  id text,
  document_id text,
  title text,
  source_type text,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    coalesce(d.title, dc.metadata ->> 'title', 'Enterprise context') as title,
    coalesce(d.source_type, dc.metadata ->> 'source_type', 'knowledge') as source_type,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  left join documents d on d.id = dc.document_id
  where filter_account_id is null
    or dc.account_id = filter_account_id
    or dc.account_id = 'global'
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;


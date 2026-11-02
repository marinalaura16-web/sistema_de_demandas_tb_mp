-- =============================================================
-- Demandas — estrutura do banco de dados (Supabase)
-- Cole TODO este arquivo em: Supabase > SQL Editor > New query > Run
-- Pode rodar mais de uma vez sem problema.
-- =============================================================

-- ---------- Perfis (nome de cada usuária) ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default ''
);

create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- perfis para usuárias que já existiam antes deste script
insert into public.perfis (id, nome)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------- Demandas ----------
create table if not exists public.demandas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  descricao text not null default '',
  prioridade smallint not null default 2 check (prioridade between 1 and 3), -- 1 alta, 2 média, 3 baixa
  status text not null default 'a_fazer' check (status in ('a_fazer', 'andamento', 'feito')),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz,
  concluido_por uuid references public.perfis(id) on delete set null
);

create index if not exists demandas_status_idx on public.demandas (status, prioridade, criado_em);

create or replace function public.demanda_atualizada()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.status = 'feito' and old.status is distinct from 'feito' then
    new.concluido_em := now();
    new.concluido_por := auth.uid();
  elsif new.status <> 'feito' then
    new.concluido_em := null;
    new.concluido_por := null;
  end if;
  return new;
end $$;

drop trigger if exists ao_atualizar_demanda on public.demandas;
create trigger ao_atualizar_demanda before update on public.demandas
  for each row execute function public.demanda_atualizada();

-- ---------- Comentários ----------
create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  demanda_id uuid not null references public.demandas(id) on delete cascade,
  autor uuid references public.perfis(id) on delete set null default auth.uid(),
  texto text not null check (length(trim(texto)) > 0),
  criado_em timestamptz not null default now()
);
create index if not exists comentarios_demanda_idx on public.comentarios (demanda_id, criado_em);

-- ---------- Anexos ----------
create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  demanda_id uuid not null references public.demandas(id) on delete cascade,
  caminho text not null,
  nome text not null,
  tipo text not null default '',
  tamanho bigint not null default 0,
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists anexos_demanda_idx on public.anexos (demanda_id);

-- ---------- Inscrições de notificação (um registro por celular) ----------
create table if not exists public.inscricoes_push (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null references public.perfis(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

-- ---------- Segurança: só quem fez login acessa ----------
alter table public.perfis enable row level security;
alter table public.demandas enable row level security;
alter table public.comentarios enable row level security;
alter table public.anexos enable row level security;
alter table public.inscricoes_push enable row level security;

drop policy if exists "ler perfis" on public.perfis;
create policy "ler perfis" on public.perfis for select to authenticated using (true);
drop policy if exists "editar proprio perfil" on public.perfis;
create policy "editar proprio perfil" on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "acesso demandas" on public.demandas;
create policy "acesso demandas" on public.demandas for all to authenticated using (true) with check (true);

drop policy if exists "ler comentarios" on public.comentarios;
create policy "ler comentarios" on public.comentarios for select to authenticated using (true);
drop policy if exists "criar comentario" on public.comentarios;
create policy "criar comentario" on public.comentarios for insert to authenticated with check (autor = auth.uid());
drop policy if exists "apagar proprio comentario" on public.comentarios;
create policy "apagar proprio comentario" on public.comentarios for delete to authenticated using (autor = auth.uid());

drop policy if exists "acesso anexos" on public.anexos;
create policy "acesso anexos" on public.anexos for all to authenticated using (true) with check (true);

drop policy if exists "proprias inscricoes" on public.inscricoes_push;
create policy "proprias inscricoes" on public.inscricoes_push for all to authenticated
  using (usuario = auth.uid()) with check (usuario = auth.uid());

-- ---------- Arquivos anexados (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 20971520) -- 20 MB por arquivo
on conflict (id) do nothing;

drop policy if exists "anexos ler" on storage.objects;
create policy "anexos ler" on storage.objects for select to authenticated using (bucket_id = 'anexos');
drop policy if exists "anexos enviar" on storage.objects;
create policy "anexos enviar" on storage.objects for insert to authenticated with check (bucket_id = 'anexos');
drop policy if exists "anexos apagar" on storage.objects;
create policy "anexos apagar" on storage.objects for delete to authenticated using (bucket_id = 'anexos');

-- ---------- Atualização em tempo real ----------
do $$
declare t text;
begin
  foreach t in array array['demandas', 'comentarios', 'anexos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

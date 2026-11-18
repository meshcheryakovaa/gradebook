-- Gradebook v14: хранилище общих журналов в Postgres (Supabase).
--
-- Выполните этот файл один раз: Supabase → SQL Editor → New query → вставить → Run.
-- Повторный запуск безопасен: данные не удаляются.
--
-- Приложение хранит те же неизменяемые файлы, что и на Яндекс Диске (аккаунты и пакеты
-- операций), но строками таблицы. Таблицы закрыты от публичного ключа: браузер обращается
-- только к функциям ниже, и каждая из них проверяет ключ команды. Записи не изменяются
-- и не удаляются через приложение — только добавляются.

create table if not exists public.gradebook_files (
  path text primary key check (path ~ '^[A-Za-z0-9:/._-]+$' and char_length(path) <= 300),
  folder text generated always as (regexp_replace(path, '/[^/]*$', '')) stored,
  data jsonb not null check (octet_length(data::text) <= 20000000),
  created_at timestamptz not null default now()
);
create index if not exists gradebook_files_folder on public.gradebook_files (folder, path);

-- Ключи команды хранятся только в виде SHA-256. Строку для добавления ключа
-- показывает само приложение: Настройки → База данных → Сгенерировать ключ.
create table if not exists public.gradebook_keys (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  note text,
  created_at timestamptz not null default now()
);

alter table public.gradebook_files enable row level security;
alter table public.gradebook_keys enable row level security;
revoke all on public.gradebook_files, public.gradebook_keys from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.gradebook_files, public.gradebook_keys from %I', r);
    end if;
  end loop;
end $$;

create or replace function public.gradebook_check(p_key text) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_key is null or length(p_key) < 20 or not exists (
    select 1 from public.gradebook_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'gradebook: неверный ключ команды' using errcode = '28000';
  end if;
end $$;

-- Содержимое файла или null, если его нет.
create or replace function public.gradebook_get(p_key text, p_path text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.gradebook_check(p_key);
  return (select data from public.gradebook_files where path = p_path);
end $$;

-- Записывает файл, только если его ещё нет. true — записан сейчас, false — уже существовал.
create or replace function public.gradebook_put(p_key text, p_path text, p_data jsonb) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare inserted boolean;
begin
  perform public.gradebook_check(p_key);
  insert into public.gradebook_files (path, data) values (p_path, p_data)
  on conflict (path) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- Имена файлов в папке (без вложенных папок) по алфавиту, после p_after, не больше p_limit.
create or replace function public.gradebook_list(p_key text, p_folder text, p_after text default '', p_limit integer default 1000)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.gradebook_check(p_key);
  return coalesce((
    select jsonb_agg(name order by name) from (
      select substr(path, length(p_folder) + 2) as name
      from public.gradebook_files
      where folder = p_folder and path > p_folder || '/' || coalesce(p_after, '')
      order by path
      limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
    ) page
  ), '[]'::jsonb);
end $$;

-- Для проверки доступности базы (и чтобы бесплатный проект не засыпал). Данных не читает.
create or replace function public.gradebook_ping() returns text
language sql stable as $$ select 'ok'::text $$;

revoke all on function public.gradebook_check(text) from public;
revoke all on function public.gradebook_get(text, text) from public;
revoke all on function public.gradebook_put(text, text, jsonb) from public;
revoke all on function public.gradebook_list(text, text, text, integer) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.gradebook_check(text) from %I', r);
      execute format('grant execute on function public.gradebook_get(text, text) to %I', r);
      execute format('grant execute on function public.gradebook_put(text, text, jsonb) to %I', r);
      execute format('grant execute on function public.gradebook_list(text, text, text, integer) to %I', r);
      execute format('grant execute on function public.gradebook_ping() to %I', r);
    end if;
  end loop;
end $$;

-- Сообщить API Supabase о новых функциях.
notify pgrst, 'reload schema';

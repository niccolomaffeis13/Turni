-- =====================================================================
--  TURNI — preparazione del database Supabase
--  Incolla tutto questo nel "SQL Editor" del progetto "turni" e premi "Run".
--  Si può eseguire anche più volte senza fare danni.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1) Tabelle --------------------------------------------------------------
create table if not exists public.ristoranti (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  password_hash text not null,               -- la password del ristorante (salvata cifrata)
  creato_da     uuid references auth.users (id) on delete set null,
  creato        timestamptz not null default now()
);
create unique index if not exists ristoranti_nome on public.ristoranti (lower(nome));

create table if not exists public.profili (
  user_id       uuid primary key,             -- l'account; per le persone di prova è un id inventato
  finto         boolean not null default false,  -- persona di prova (la crea e la usa solo il creatore)
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  nickname      text not null,
  tipo          text not null check (tipo in ('fisso', 'occasionale')),
  admin         boolean not null default false,
  aggiornato    timestamptz not null default now()
);
create unique index if not exists profili_nickname on public.profili (ristorante_id, lower(nickname));
-- settore: sala o cucina (chi c'era già passa in cucina)
alter table public.profili add column if not exists settore text not null default 'cucina';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profili_settore_check') then
    alter table public.profili add constraint profili_settore_check check (settore in ('sala', 'cucina'));
  end if;
end $$;

-- Esperto / non esperto: promemoria dell'amministratore, gli altri NON lo possono leggere
create table if not exists public.esperti (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  user_id       uuid not null references public.profili (user_id) on delete cascade,
  esperto       boolean not null default false,
  aggiornato    timestamptz not null default now(),
  primary key (user_id)
);

-- Disponibilità: stato 'si' (ci sono), 'no' (non ci sono), '' (niente segnato)
create table if not exists public.disponibilita (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  user_id       uuid not null references public.profili (user_id) on delete cascade,
  giorno        date not null,
  turno         text not null check (turno in ('pranzo', 'cena')),
  stato         text not null default '' check (stato in ('si', 'no', '')),
  aggiornato    timestamptz not null default now(),
  primary key (user_id, giorno, turno)
);
create index if not exists disponibilita_rist on public.disponibilita (ristorante_id, giorno);
-- orario in cui ci sei ('' = inizio / fine turno)
alter table public.disponibilita add column if not exists dalle text not null default '';
alter table public.disponibilita add column if not exists alle text not null default '';

-- Chiusure del ristorante (con ripetizione e giorni riaperti uno per uno)
create table if not exists public.chiusure (
  id            uuid primary key,
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  dal           date not null,
  al            date,
  turno         text not null default 'tutto' check (turno in ('tutto', 'pranzo', 'cena')),
  ripeti        text not null default '' check (ripeti in ('', 'settimana', 'mese', 'anno')),
  fino          date,                         -- fino a quando si ripete (vuoto = sempre)
  saltate       jsonb not null default '[]'::jsonb,
  nota          text not null default '',
  eliminata     boolean not null default false,
  aggiornato    timestamptz not null default now()
);

create table if not exists public.prenotati (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  giorno        date not null,
  turno         text not null check (turno in ('pranzo', 'cena')),
  numero        integer not null default 0 check (numero >= 0),
  aggiornato    timestamptz not null default now(),
  primary key (ristorante_id, giorno, turno)
);

-- Turni ufficiali: per ogni giorno e turno l'elenco delle persone
create table if not exists public.turni (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  giorno        date not null,
  turno         text not null check (turno in ('pranzo', 'cena')),
  persone       jsonb not null default '[]'::jsonb,
  aggiornato    timestamptz not null default now(),
  primary key (ristorante_id, giorno, turno)
);

-- Bozza dei turni: la vedono e la scrivono solo gli amministratori
create table if not exists public.bozze (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  giorno        date not null,
  turno         text not null check (turno in ('pranzo', 'cena')),
  persone       jsonb not null default '[]'::jsonb,
  attiva        boolean not null default true,
  aggiornato    timestamptz not null default now(),
  primary key (ristorante_id, giorno, turno)
);

-- Impostazioni del ristorante (es. ore di un pranzo e di una cena)
create table if not exists public.impostazioni (
  ristorante_id uuid not null references public.ristoranti (id) on delete cascade,
  chiave        text not null,
  valore        jsonb not null,
  aggiornato    timestamptz not null default now(),
  primary key (ristorante_id, chiave)
);

-- 2) Funzioni di aiuto per i permessi -------------------------------------
create or replace function public.mio_ristorante() returns uuid
language sql stable security definer set search_path = public as $$
  select ristorante_id from public.profili where user_id = auth.uid()
$$;

create or replace function public.sono_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.profili where user_id = auth.uid()), false)
$$;

-- chi ha creato il ristorante
create or replace function public.sono_creatore() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ristoranti where id = public.mio_ristorante() and creato_da = auth.uid())
$$;
-- è una persona di prova del mio ristorante?
create or replace function public.e_finto(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profili where user_id = p_user and finto and ristorante_id = public.mio_ristorante())
$$;

-- 3) Sicurezza: ognuno vede solo il suo ristorante -------------------------
alter table public.ristoranti    enable row level security;
alter table public.profili       enable row level security;
alter table public.esperti       enable row level security;
alter table public.disponibilita enable row level security;
alter table public.chiusure      enable row level security;
alter table public.prenotati     enable row level security;
alter table public.turni         enable row level security;
alter table public.bozze         enable row level security;
alter table public.impostazioni  enable row level security;

-- ristoranti: nessun accesso diretto (nome e codici passano dalle funzioni sotto)
-- profili: si leggono quelli del proprio ristorante; si cambiano solo con le funzioni sotto
drop policy if exists "profili: leggi" on public.profili;
create policy "profili: leggi" on public.profili for select to authenticated using (ristorante_id = public.mio_ristorante());

-- esperti: solo l'amministratore li legge (si cambiano con imposta_esperto)
drop policy if exists "esperti: solo admin" on public.esperti;
create policy "esperti: solo admin" on public.esperti for select to authenticated
  using (ristorante_id = public.mio_ristorante() and public.sono_admin());

-- disponibilità: tutti leggono quelle del ristorante, ognuno scrive solo le sue
drop policy if exists "disp: leggi" on public.disponibilita;
drop policy if exists "disp: aggiungi" on public.disponibilita;
drop policy if exists "disp: modifica" on public.disponibilita;
create policy "disp: leggi" on public.disponibilita for select to authenticated using (ristorante_id = public.mio_ristorante());
-- (il creatore può segnare anche per le persone di prova, per fare le prove)
create policy "disp: aggiungi" on public.disponibilita for insert to authenticated
  with check ((user_id = auth.uid() or (public.sono_creatore() and public.e_finto(user_id))) and ristorante_id = public.mio_ristorante());
create policy "disp: modifica" on public.disponibilita for update to authenticated
  using (user_id = auth.uid() or (public.sono_creatore() and public.e_finto(user_id)))
  with check ((user_id = auth.uid() or (public.sono_creatore() and public.e_finto(user_id))) and ristorante_id = public.mio_ristorante());

-- chiusure, prenotati, turni: tutti leggono, solo l'amministratore scrive
do $$
declare t text;
begin
  foreach t in array array['chiusure', 'prenotati', 'turni', 'impostazioni'] loop
    execute format('drop policy if exists "%1$s: leggi" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: aggiungi" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: modifica" on public.%1$I', t);
    execute format('create policy "%1$s: leggi" on public.%1$I for select to authenticated using (ristorante_id = public.mio_ristorante())', t);
    execute format('create policy "%1$s: aggiungi" on public.%1$I for insert to authenticated with check (ristorante_id = public.mio_ristorante() and public.sono_admin())', t);
    execute format('create policy "%1$s: modifica" on public.%1$I for update to authenticated using (ristorante_id = public.mio_ristorante() and public.sono_admin()) with check (ristorante_id = public.mio_ristorante() and public.sono_admin())', t);
  end loop;
end $$;

-- bozze: solo l'amministratore legge e scrive
drop policy if exists "bozze: leggi" on public.bozze;
drop policy if exists "bozze: aggiungi" on public.bozze;
drop policy if exists "bozze: modifica" on public.bozze;
create policy "bozze: leggi" on public.bozze for select to authenticated using (ristorante_id = public.mio_ristorante() and public.sono_admin());
create policy "bozze: aggiungi" on public.bozze for insert to authenticated with check (ristorante_id = public.mio_ristorante() and public.sono_admin());
create policy "bozze: modifica" on public.bozze for update to authenticated using (ristorante_id = public.mio_ristorante() and public.sono_admin()) with check (ristorante_id = public.mio_ristorante() and public.sono_admin());

grant select on public.profili, public.esperti to authenticated;
grant select, insert, update on public.bozze, public.impostazioni to authenticated;
grant select, insert, update on public.disponibilita, public.chiusure, public.prenotati, public.turni to authenticated;

-- 4) Funzioni chiamate dall'app ---------------------------------------------
-- (le versioni precedenti, senza il settore, si tolgono)
drop function if exists public.crea_ristorante(text, text, text, text);
drop function if exists public.unisciti(uuid, text, text, text);
drop function if exists public.modifica_profilo(text, text);

-- Crea un ristorante con nome e password: chi lo crea è amministratore
create or replace function public.crea_ristorante(p_nome text, p_password text, p_nickname text, p_tipo text, p_settore text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r_id uuid;
begin
  if auth.uid() is null then raise exception 'Devi prima accedere'; end if;
  if exists (select 1 from profili where user_id = auth.uid()) then raise exception 'Sei già dentro un ristorante'; end if;
  if p_tipo not in ('fisso', 'occasionale') then raise exception 'Tipologia non valida'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Scrivi il nome del ristorante'; end if;
  if length(coalesce(p_password, '')) < 4 then raise exception 'La password del ristorante deve avere almeno 4 caratteri'; end if;
  if length(trim(coalesce(p_nickname, ''))) < 2 then raise exception 'Scegli un nickname'; end if;
  if exists (select 1 from ristoranti where lower(nome) = lower(trim(p_nome))) then raise exception 'Esiste già un ristorante con questo nome: scegline un altro'; end if;
  insert into ristoranti (nome, password_hash, creato_da) values (trim(p_nome), crypt(p_password, gen_salt('bf')), auth.uid()) returning id into r_id;
  if p_settore not in ('sala', 'cucina') then raise exception 'Scegli sala o cucina'; end if;
  insert into profili (user_id, ristorante_id, nickname, tipo, admin, settore) values (auth.uid(), r_id, trim(p_nickname), p_tipo, true, p_settore);
  return json_build_object('ristorante_id', r_id);
end $$;

-- Cerca i ristoranti per nome (si vede solo il nome, mai la password)
create or replace function public.cerca_ristoranti(p_testo text)
returns table (id uuid, nome text) language sql stable security definer set search_path = public as $$
  select r.id, r.nome from ristoranti r
  where auth.uid() is not null and length(trim(coalesce(p_testo, ''))) >= 2
    and r.nome ilike '%' || replace(replace(trim(p_testo), '%', ''), '_', '') || '%'
  order by lower(r.nome) limit 10
$$;

-- Entra in un ristorante con la password: si entra sempre come NON amministratore
create or replace function public.unisciti(p_ristorante uuid, p_password text, p_nickname text, p_tipo text, p_settore text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r ristoranti%rowtype;
begin
  if auth.uid() is null then raise exception 'Devi prima accedere'; end if;
  if exists (select 1 from profili where user_id = auth.uid()) then raise exception 'Sei già dentro un ristorante'; end if;
  if p_tipo not in ('fisso', 'occasionale') then raise exception 'Tipologia non valida'; end if;
  if length(trim(coalesce(p_nickname, ''))) < 2 then raise exception 'Scegli un nickname'; end if;
  select * into r from ristoranti where id = p_ristorante;
  if not found then raise exception 'Ristorante non trovato'; end if;
  if r.password_hash <> crypt(coalesce(p_password, ''), r.password_hash) then
    perform pg_sleep(1);   -- rallenta chi prova password a caso
    raise exception 'Password del ristorante sbagliata';
  end if;
  if p_settore not in ('sala', 'cucina') then raise exception 'Scegli sala o cucina'; end if;
  insert into profili (user_id, ristorante_id, nickname, tipo, admin, settore) values (auth.uid(), r.id, trim(p_nickname), p_tipo, false, p_settore);
  return json_build_object('ristorante_id', r.id);
end $$;

-- Un amministratore può nominare (o togliere) altri amministratori; il creatore resta sempre
create or replace function public.imposta_admin(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not sono_admin() then raise exception 'Solo un amministratore può farlo'; end if;
  if not exists (select 1 from profili where user_id = p_user and ristorante_id = mio_ristorante()) then raise exception 'Persona non trovata'; end if;
  if not p_admin and p_user = (select creato_da from ristoranti where id = mio_ristorante()) then raise exception 'Chi ha creato il ristorante resta amministratore'; end if;
  if not p_admin and p_user = auth.uid() then raise exception 'Non puoi toglierti da solo'; end if;
  update profili set admin = p_admin, aggiornato = now() where user_id = p_user;
end $$;

-- Cambia la password del ristorante (solo amministratore)
create or replace function public.cambia_password_ristorante(p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not sono_admin() then raise exception 'Solo un amministratore può farlo'; end if;
  if length(coalesce(p_password, '')) < 4 then raise exception 'Almeno 4 caratteri'; end if;
  update ristoranti set password_hash = crypt(p_password, gen_salt('bf')) where id = mio_ristorante();
end $$;

-- Cambia il proprio nickname e la tipologia
create or replace function public.modifica_profilo(p_nickname text, p_tipo text, p_settore text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tipo not in ('fisso', 'occasionale') then raise exception 'Tipologia non valida'; end if;
  if length(trim(coalesce(p_nickname, ''))) < 2 then raise exception 'Scegli un nickname'; end if;
  if p_settore not in ('sala', 'cucina') then raise exception 'Scegli sala o cucina'; end if;
  update profili set nickname = trim(p_nickname), tipo = p_tipo, settore = p_settore, aggiornato = now() where user_id = auth.uid();
end $$;

-- Solo l'amministratore decide chi è esperto (l'amministratore lo è sempre)
create or replace function public.imposta_esperto(p_user uuid, p_esperto boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  if not exists (select 1 from profili where user_id = p_user and ristorante_id = mio_ristorante()) then
    raise exception 'Persona non trovata';
  end if;
  insert into esperti (ristorante_id, user_id, esperto, aggiornato) values (mio_ristorante(), p_user, p_esperto, now())
  on conflict (user_id) do update set esperto = excluded.esperto, ristorante_id = excluded.ristorante_id, aggiornato = now();
end $$;

-- Persone di prova: 6 colleghi fissi finti (solo il creatore)
create or replace function public.crea_persone_prova()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; nome text;
begin
  if not sono_creatore() then raise exception 'Solo chi ha creato il ristorante può farlo'; end if;
  foreach nome in array array['Giulia', 'Marco', 'Sara', 'Luca', 'Chiara', 'Davide'] loop
    nome := nome || ' (prova)';
    if not exists (select 1 from profili where ristorante_id = mio_ristorante() and lower(nickname) = lower(nome)) then
      insert into profili (user_id, ristorante_id, nickname, tipo, admin, finto) values (gen_random_uuid(), mio_ristorante(), nome, 'fisso', false, true);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Toglie le persone di prova (anche dai turni e dalle bozze)
create or replace function public.elimina_persone_prova()
returns integer language plpgsql security definer set search_path = public as $$
declare ids text[]; n integer;
begin
  if not sono_creatore() then raise exception 'Solo chi ha creato il ristorante può farlo'; end if;
  select coalesce(array_agg(user_id::text), '{}') into ids from profili where finto and ristorante_id = mio_ristorante();
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then return 0; end if;
  update turni set persone = persone - ids, aggiornato = now() where ristorante_id = mio_ristorante() and persone ?| ids;
  update bozze set persone = persone - ids, aggiornato = now() where ristorante_id = mio_ristorante() and persone ?| ids;
  delete from profili where finto and ristorante_id = mio_ristorante();
  return n;
end $$;

-- Nome del ristorante e chi l'ha creato
create or replace function public.info_ristorante()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('nome', r.nome, 'creato_da', r.creato_da)
  from ristoranti r where r.id = mio_ristorante()
$$;

revoke all on function public.crea_ristorante(text, text, text, text, text) from public, anon;
revoke all on function public.cerca_ristoranti(text) from public, anon;
revoke all on function public.unisciti(uuid, text, text, text, text) from public, anon;
revoke all on function public.imposta_admin(uuid, boolean) from public, anon;
revoke all on function public.cambia_password_ristorante(text) from public, anon;
revoke all on function public.modifica_profilo(text, text, text) from public, anon;
revoke all on function public.imposta_esperto(uuid, boolean) from public, anon;
revoke all on function public.info_ristorante() from public, anon;
revoke all on function public.crea_persone_prova() from public, anon;
revoke all on function public.elimina_persone_prova() from public, anon;
grant execute on function public.crea_persone_prova(), public.elimina_persone_prova() to authenticated;
grant execute on function public.crea_ristorante(text, text, text, text, text), public.cerca_ristoranti(text), public.unisciti(uuid, text, text, text, text),
  public.imposta_admin(uuid, boolean), public.cambia_password_ristorante(text),
  public.modifica_profilo(text, text, text), public.imposta_esperto(uuid, boolean), public.info_ristorante() to authenticated;

-- 5) Aggiornamento in tempo reale tra colleghi ------------------------------
do $$
declare t text;
begin
  foreach t in array array['profili', 'esperti', 'disponibilita', 'chiusure', 'prenotati', 'turni', 'bozze', 'impostazioni'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

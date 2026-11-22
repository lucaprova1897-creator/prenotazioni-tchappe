-- ============================================================================
-- Allergie e intolleranze — novembre 2026
--
--  1. Avviso automatico "Richiesta alimentare da verificare al tavolo":
--     lo imposta il DATABASE a ogni inserimento/modifica, quindi vale per
--     qualunque prenotazione, chiunque l'abbia fatta e da qualunque
--     dispositivo (anche con una versione vecchia dell'app).
--  2. Registro del consenso (quando e chi l'ha confermato nel pop-up).
--  3. Conservazione: le SOLE informazioni su allergie/intolleranze si
--     cancellano 10 giorni dopo la data del servizio, oppure (entro la
--     notte successiva) se la prenotazione è cancellata, no-show o
--     archiviata. Tutto il resto della prenotazione resta con le regole
--     di prima (anonimizzazione dopo 12 mesi).
--  4. La manutenzione notturna non manda notifiche "MODIFICA PRENOTAZIONE"
--     ai telefoni (prima ogni modifica fatta dal sistema le avrebbe fatte
--     partire).
--
-- Da applicare PRIMA di pubblicare la nuova versione dell'app (l'app
-- scrive le colonne consenso_allergie_*).
-- Come annullare: vedi in fondo al file.
-- ============================================================================

begin;

-- 1) Nuove colonne -----------------------------------------------------------
alter table public.prenotazioni
  add column if not exists avviso_alimentare     text,
  add column if not exists consenso_allergie_il  timestamptz,
  add column if not exists consenso_allergie_da  text;

comment on column public.prenotazioni.avviso_alimentare is
  'Impostato in automatico dal trigger trg_avviso_alimentare quando intolerances non è vuoto.';
comment on column public.prenotazioni.consenso_allergie_il is
  'Quando il personale ha confermato il consenso a annotare gli allergeni (pop-up nell''app).';
comment on column public.prenotazioni.consenso_allergie_da is
  'Chi ha confermato il consenso (operatore e dispositivo).';

-- 2) Avviso automatico -------------------------------------------------------
create or replace function private.imposta_avviso_alimentare()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if nullif(btrim(coalesce(new.intolerances, '')), '') is not null then
    new.avviso_alimentare := 'Richiesta alimentare da verificare al tavolo';
  else
    new.avviso_alimentare := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_avviso_alimentare on public.prenotazioni;
create trigger trg_avviso_alimentare
  before insert or update on public.prenotazioni
  for each row execute function private.imposta_avviso_alimentare();

-- 3) Notifiche: silenziose durante la manutenzione automatica ---------------
--    (stesso codice di prima + la riga "lou.manutenzione")
create or replace function public.notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
begin
  if current_setting('lou.manutenzione', true) = 'on' then return new; end if;
  perform net.http_post(
    url := 'https://shdzchwhymajnqhocirp.supabase.co/functions/v1/send-push',
    headers := private.intestazioni_notifiche(),
    body := jsonb_build_object('type', 'INSERT', 'table', 'prenotazioni', 'record', to_jsonb(NEW), 'old_record', null));
  return NEW;
end;
$function$;

create or replace function public.notify_booking_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
begin
  if current_setting('lou.manutenzione', true) = 'on' then return new; end if;
  perform net.http_post(
    url := 'https://shdzchwhymajnqhocirp.supabase.co/functions/v1/send-push',
    headers := private.intestazioni_notifiche(),
    body := jsonb_build_object('type', 'UPDATE', 'table', 'prenotazioni', 'record', to_jsonb(NEW), 'old_record', to_jsonb(OLD)));
  return NEW;
end;
$function$;

-- 4) Conservazione (cron "conservazione-dati", ogni notte alle 3:17) ---------
create or replace function private.applica_conservazione()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_a int; v_p int; v_b int; v_o int;
begin
  -- niente notifiche per le modifiche fatte dalla manutenzione
  perform set_config('lou.manutenzione', 'on', true);

  -- NUOVO: allergie/intolleranze — 10 giorni dopo il servizio, oppure
  -- subito (alla prima notte) se cancellata, no-show o archiviata.
  -- Si svuota SOLO il campo allergie (e il suo avviso, via trigger).
  update public.prenotazioni
     set intolerances = ''
   where coalesce(intolerances, '') <> ''
     and (date < current_date - 10 or status in ('cancelled', 'noshow', 'archived'));
  get diagnostics v_a = row_count;

  -- INVARIATO: resto della prenotazione dopo 12 mesi
  update public.prenotazioni
     set name = 'Cliente (anonimizzato)', phone = '', intolerances = '', special_needs = '', notes = '',
         created_by = null, last_device_id = null
   where date < current_date - interval '12 months' and name <> 'Cliente (anonimizzato)';
  get diagnostics v_p = row_count;
  update public.buoni_regalo set nome = '', telefono = '', note = ''
   where coalesce(usato_il::date, scadenza) < current_date - interval '12 months' and (nome <> '' or telefono <> '');
  get diagnostics v_b = row_count;
  delete from public.ordini_servizio where event_date < current_date - interval '12 months';
  get diagnostics v_o = row_count;
  delete from private.registro where il < now() - interval '12 months';

  insert into private.registro (evento, dettagli)
  values ('conservazione_applicata', jsonb_build_object('allergie', v_a, 'prenotazioni', v_p, 'buoni', v_b, 'ods', v_o));
  return jsonb_build_object('allergie', v_a, 'prenotazioni', v_p, 'buoni', v_b, 'ods', v_o);
end;
$function$;

-- 5) Avviso sulle prenotazioni che hanno già un'allergia (senza notifiche)
select set_config('lou.manutenzione', 'on', true);
update public.prenotazioni set intolerances = intolerances where coalesce(intolerances, '') <> '';

commit;

-- ============================================================================
-- COME ANNULLARE (se servisse):
--   drop trigger if exists trg_avviso_alimentare on public.prenotazioni;
--   drop function if exists private.imposta_avviso_alimentare();
--   e ricreare private.applica_conservazione() senza il blocco "NUOVO".
--   Le colonne aggiunte si possono lasciare (non danno fastidio) oppure:
--   alter table public.prenotazioni drop column avviso_alimentare,
--     drop column consenso_allergie_il, drop column consenso_allergie_da;
--   NB: le allergie già cancellate dalla regola dei 10 giorni NON si
--   possono recuperare.
-- ============================================================================

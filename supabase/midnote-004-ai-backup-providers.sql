-- MidNote 004: backup AI providers (Groq, Mistral) behind Cloudflare Workers AI.   Brought to u by MidManStudio
--
-- Safe to run more than once. It ONLY adds rows, and every row ships DISABLED, so running it changes nothing
-- until you switch a provider on (see "TURN ON" at the bottom). It never touches the existing Cloudflare rows.
--
-- Credits mean the same thing whoever answers, so the backup models use the DEFAULT model's rates
-- (4119 in / 34868 out per million tokens). daily_cap is that provider's own shared pool in credits:
--   groq    2000  ~ 100k tokens/day of llama-3.3-70b-versatile (Groq's free ceiling) at a balanced in/out mix
--   mistral 1500  conservative; Mistral shows the real free limits only in its console (Limits page)
-- Both providers are on free plans with NO card, so they can only refuse, never bill. Keep it that way.
--
-- Written against the real columns (checked from the live project): midnote_ai_providers(provider, label,
-- daily_cap, enabled) and midnote_ai_models(model, provider, label, in_rate, out_rate, max_output,
-- max_input_tokens, enabled, is_default).

insert into public.midnote_ai_providers (provider, label, daily_cap, enabled)
select v.provider, v.label, v.daily_cap, false
from (values
  ('groq',    'Groq',    2000),
  ('mistral', 'Mistral', 1500)
) as v(provider, label, daily_cap)
where not exists (select 1 from public.midnote_ai_providers p where p.provider = v.provider);

insert into public.midnote_ai_models (model, provider, label, in_rate, out_rate, max_output, max_input_tokens, enabled, is_default)
select v.model, v.provider, v.label, 4119, 34868, 900, 8000, false, false
from (values
  ('llama-3.3-70b-versatile', 'groq',    'Llama 3.3 70B (Groq)'),
  ('mistral-small-latest',    'mistral', 'Mistral Small')
) as v(model, provider, label)
where not exists (select 1 from public.midnote_ai_models m where m.model = v.model);

-- What is there now (the two new providers show enabled = false):
select 'provider' as kind, to_jsonb(p)::text as info from public.midnote_ai_providers p
union all
select 'model', to_jsonb(m)::text from public.midnote_ai_models m order by 1, 2;

-- ---------------------------------------------------------------------------------------------------------
-- TURN ON (one provider at a time, AFTER its API key is a GitHub secret AND the Deploy AI Worker workflow ran,
-- AND you switched on that provider's privacy setting: Groq -> Zero Data Retention, Mistral -> opt out of training):
--
--   update public.midnote_ai_providers set enabled = true where provider = 'groq';
--   update public.midnote_ai_models    set enabled = true where model    = 'llama-3.3-70b-versatile';
--
--   update public.midnote_ai_providers set enabled = true where provider = 'mistral';
--   update public.midnote_ai_models    set enabled = true where model    = 'mistral-small-latest';
--
-- TURN OFF (instant, no redeploy):
--   update public.midnote_ai_providers set enabled = false where provider in ('groq', 'mistral');
-- Shrink or grow a pool:
--   update public.midnote_ai_providers set daily_cap = 1000 where provider = 'groq';
-- ---------------------------------------------------------------------------------------------------------

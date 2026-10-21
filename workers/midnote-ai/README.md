# MidNote AI proxy

A Cloudflare Worker that sits between the app and Workers AI. The phone never holds an AI key and never
talks to the model directly: it sends its Supabase sign-in token to this Worker, and the Worker decides
whether the free budget allows the call.

## The free-budget rule

Nothing here may ever cost money. Three layers make that true:

1. **The platform stops, it does not bill.** On the Workers *Free* plan, Workers AI returns errors after
   10,000 neurons per UTC day. Never add a card to this Cloudflare account and never switch to Workers Paid.
2. **A shared daily pool** (`midnote_ai_providers.daily_cap`, default **8,000** neurons) is reserved
   *before* every call and settled to the real token usage after. The whole app together cannot reserve
   more than the cap. If Cloudflare ever says the allowance is gone anyway, the pool closes for the rest
   of the UTC day (circuit breaker).
3. **Per-person credits.** 1 credit = 1 neuron at the model's real rate. Signup grant 3,000, topped up to
   1,000 every 30 days, at most 400 per UTC day, 6 requests a minute, 2 at a time.

Any failure in steps "who is asking" or "reserve" means the model is **not** called (fail closed).

## Order of an AI call

`POST /v1/ai/run` -> verify the Supabase token -> check size/shape -> `midnote_ai_reserve` -> run the model
with the ledger's `max_tokens` -> `midnote_ai_settle` (real usage; unknown usage = full hold) or
`midnote_ai_release` on failure. A timeout is never released: the hold expires, the pool keeps it as spent.

`GET /v1/ai/status` returns `{enabled, has_account, balance, daily_cap, daily_left, next_topup_at, pool_open, resets_in}`.
`GET /health` answers `{ok:true}`.

Request bodies (the server owns the prompts):

```json
{ "task": "create",    "prompt": "a packing list for a weekend away" }
{ "task": "transform", "instruction": "make it shorter", "text": "..." }
{ "task": "transform", "instruction": "make it shorter", "text": "<the selection>", "mode": "edit",
  "before": "<note text before the selection>", "after": "<note text after it>" }
{ "task": "chat",      "note": "...the note...", "messages": [{"role":"user","content":"when is it?"}] }
```

A transform with a `mode` is a **selection task** (the note editor's AI button): `edit` returns a replacement
for the selection, `continue` returns text that follows it, `ask` answers a question about it. `before` and
`after` (each up to 16,000 characters) are the rest of the note, sent only so the model understands it; the
Worker keeps what is nearest the selection and trims the rest so the estimated input stays under 7,600
tokens (the ledger refuses over 8,000). The reply is tidied (echoed markers, a code fence or quotes around
everything, "Here is the text:" lines, stray `**bold**`). `before`/`after` without a `mode` are refused.

Optional `"max_tokens"` (1..4096, the ledger clamps it to the model's limit). Answers:
`{ text, model, credits_charged, balance }` (plus `truncated: true` when the answer used the whole output allowance and was probably cut off), or `{ error, message, ... }` with these `error` codes:
`signed-out 401`, `bad-request 400`, `too-long 413`, `no-credits 402`, `daily-cap 429`, `busy 429`,
`rate-limited 429`, `pool-exhausted 503 (+ Retry-After)`, `disabled 503`, `ai-unavailable 503`,
`ai-failed 502`, `timeout 504`, `empty-response 502`.

## Set it up (once)

1. Supabase -> SQL editor: run `midnote-003-ai-ledger.sql`.
2. GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers"), `CLOUDFLARE_ACCOUNT_ID`,
   `SUPABASE_SECRET_KEY` (the `sb_secret_...` key). `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` already exist.
3. Actions -> **Deploy AI Worker** -> Run workflow. It checks the settings, deploys, proves anonymous
   requests get 401, and prints the Worker URL in the run summary.
4. Add the GitHub secret `AI_PROXY_URL` = that URL (no trailing slash).

## Knobs (SQL editor, no redeploy)

```sql
update public.midnote_ai_settings set enabled = false;                       -- KILL SWITCH for all AI
update public.midnote_ai_providers set daily_cap = 5000 where provider='cf'; -- shrink or grow the shared pool
update public.midnote_ai_settings set user_daily_cap = 200, signup_grant = 1500;
update public.midnote_ai_models set enabled = true where model = '@cf/qwen/qwen3-30b-a3b-fp8'; -- try a model
update public.midnote_ai_models set is_default = (model = '@cf/qwen/qwen3-30b-a3b-fp8');      -- make it the default
-- give yourself credits while testing:
update public.midnote_ai_accounts set balance = 100000 where user_id = '<your user id>';
```

Only models on the *free* Workers plan belong in `midnote_ai_models`. Reasoning models can spend many
output tokens on thinking: try one with a small `max_output` first and watch what it is charged.

Worker-side switch: set the variable `AI_ENABLED` to `off` in the Worker's settings.

## How far the free tier goes

About 20 neurons per typical request (1,500 tokens in, 400 out on the default model), so the 8,000 pool is
roughly **400 requests a day for everybody together**. That is the honest ceiling of "free". When the pool
is used up the app says AI is resting until midnight UTC. Growing past that is a deliberate decision
(paid Workers AI or a premium plan), not something that can happen by accident.

## Privacy

Workers AI keeps no prompts and does not train on them (Cloudflare's data-usage page). This Worker logs
nothing (`observability` is off) and the ledger stores only counts, never notes or answers. Do not add
AI Gateway logging or caching in front of it.

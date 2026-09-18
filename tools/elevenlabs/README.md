# Olivia, the voice agent

`olivia-knowledge-base.txt` is what the ElevenLabs agent knows: the 21 shop
boxes with prices and contents, the corporate tiers, the concierge plans, lead
times, payment terms and the allergen rule. It is generated from the marketing
site, so it cannot drift from what the shop actually sells.

The agent is `agent_3101kn8rkd7heb0rt2p5gtfqjf3a` in the VioX ElevenLabs
workspace, answering `(551) 246-0028` and the widget on every site page.

## When prices or boxes change

1. Edit `site/assets/js/site.js` as usual and run `node tools/build-pages.mjs`.
2. Regenerate this file (the box list comes from the same place the CRM seed
   does, so the two always agree).
3. Paste it into the ElevenLabs knowledge base document
   `Occasions Box — catalogue, pricing, concierge, policies`.
4. Run `cd crm && npm run sql:bundle` and re-run
   `supabase/seed/occasionsbox_catalogue.sql` so the CRM catalogue matches too.

## Her tools

Olivia reads and writes the CRM through five webhook tools, documented in
`crm/README.md`. They all carry `SITE_API_KEY` as `x-api-key`, so the key must
match between Vercel (project `ob-crm`) and the tool definitions in ElevenLabs.
If Olivia starts saying she cannot save anything, that mismatch is the first
thing to check.

## The widget's allowlist

ElevenLabs refuses a widget connection from a host that is not on the agent's
allowlist, with `Host ... is not allowed to connect to this agent`. The list
currently holds `occasionsbox.com`, `www.occasionsbox.com`, the three
`ob-cinematic*.vercel.app` hosts and `localhost`. A new Vercel preview URL needs
adding before the widget will open on it.

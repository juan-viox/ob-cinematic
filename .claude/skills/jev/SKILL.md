---
name: jev
description: Use Jev (typesafe/jev-1.13 via OpenRouter) to sort, classify, score, rank, triage, or yes/no-judge any pile of text: emails, messages, leads, tickets, headlines, records. Jev decides, Claude writes. Use when the user says "use Jev", "sort/classify/score/rank these with Jev", "have Jev decide", or when a task is putting many items into buckets, on a scale, or through a yes/no check.
version: 1.2.0
user-invocable: true
argument-hint: "[what to decide] [the items or a file]"
---

# Jev: sort, score, and decide over any pile of text

Jev (`typesafe/jev-1.13`, reached through OpenRouter's alpha `decisions` route) does not write.
It takes a piece of text plus typed questions and returns typed answers in roughly 0.35–0.45 s for a
few hundred-thousandths of a dollar. Three shapes only:

| shape | question | answer |
|---|---|---|
| `choice` | pick one option from a list | `choice` + `probabilities` per option + `confidence` |
| `score` | place the text on an ordered scale you describe | `score` (0..N, may land between levels) + `probabilities` + `confidence` |
| `noul` | is this statement true? | `noul` = probability it is true (0–1); no separate confidence |

Read `reference.md` in this folder for the exact request/response contract, limits, and the
question-writing rules. The live docs (https://docs.typesafe.ai/llms.txt) win over anything here.

## The rule (set by Juan, 2026-09-22)

1. **Jev decides, Claude writes.** Claude designs the questions, sends the items, reads the answers,
   and writes the result. Jev supplies the judgment. Never ask Jev to generate, summarize, or extract.
2. **When Jev isn't sure, Claude makes the call, and says so.** Unsure means: a `choice` or `score`
   confidence below 0.6, or a `noul` between 0.2 and 0.8 inclusive. Every hand-made call is labelled
   "my call" in the output, next to Jev's numbers.
   - For a `score` used to rank, a low confidence means the *label* is uncertain (report it as
     "between L1 and L2, my call: L2"); the ordering by `score` still stands.
   - High-stakes: when an answer would directly trigger an action (send, refund, delete, pay), act
     automatically only on a confidence above 0.85, or a `noul` outside 0.15–0.85; otherwise decide by
     hand or ask Juan. Sorting and labelling are not high-stakes.
   - Confidence describes how peaked Jev's answer is, not whether it is correct. Before trusting the
     thresholds on a new question set, check 3–5 items whose answer you already know.
3. **Anything sent to Jev leaves the computer** (OpenRouter → TypeSafe). Before sending, tell Juan
   in one line what will go out (how many items, what kind of text, where it came from) and ask
   whether any of it is private, unless he already told you to send it in this conversation or it is
   clearly public or made-up. Never send the padrón or any voter PII (Ley 172-13), credentials, financial
   or medical records, or anything marked confidential. `--show-request` prints the first request in
   full plus the count; `--show-request-all` prints every request. Review `items.json` itself when in doubt.

## When to reach for Jev

- "Which of these are X?", "sort these into…", "rate/score/rank these", "does this need a reply?",
  "triage this inbox", "which headlines matter", "is this lead worth a call": any judgment a
  knowledgeable person makes in a second, repeated over many items.
- Not for: writing anything, summarizing, free-text extraction, counting, arithmetic, date
  comparison, or judging a long document whole. Filter to the relevant part first: the limit is 32k
  tokens for the state plus the longest question, 64k for the state plus all questions.
- English is where Jev is most accurate; Spanish and other languages work but less well. On a
  non-English pile, first run 3–5 items with known answers, once with the questions written in English
  and once in the items' language, keep the wording that agrees with the known answers, and lean on
  confidence more than usual.

## Procedure

1. **Collect the items.** Build a JSON array in the scratchpad (`items.json`). Each element is one
   item's state: a string, or better an object with named fields. Wrap each item as
   `{"id": "...", "state": {"email": {...}}}` (keys exactly `id` and `state`; ids unique): the script sends
   `state` and labels the row with `id`. Any other object is sent whole, so a record that happens to have
   a `state` column must still be wrapped. Keep only the fields the questions need; unrelated detail costs accuracy.
2. **Design the questions** (usually 2–6), saved as `questions.json`. One judgment per question.
   Buckets → `choice` with every option described and an `other` option. A degree of anything (lead
   strength, urgency, quality, risk) → `score` with 2–10 levels that describe situations, not degrees;
   rank by `score`. A genuine yes/no whose probability is the signal (relevant? duplicate? needs a
   reply?) → `noul`, phrased so that high = yes; a noul is *not* a degree scale, so never use one to
   rank "how much". Point at fields with backticks (``"Does `email` ask for pricing?"``). Write the
   full question in `instructions`: question ids are hidden from the model, but option names and any
   field names inside structured criteria are shown to it, so name those meaningfully. Ask every
   question you might need in the same request; extra questions are nearly free and run in parallel.
3. **Preview and privacy gate.**
   `python3 .claude/skills/jev/scripts/jev.py batch --items items.json --questions questions.json --show-request`
   (or `--show-request-all`). Then apply rule 3 above.
4. **Run.**
   `python3 .claude/skills/jev/scripts/jev.py batch --items items.json --questions questions.json`
   Options: `--out results.jsonl` (default `<items minus .json>.results.jsonl`, e.g. `items.results.jsonl`),
   `--concurrency 6`. One item: `ask --state-file state.json --questions questions.json`, add `--json`
   for the raw response (`ask` only; `_latency_ms` and `_route` in it are added by the script).
   The script reads the key from the macOS Keychain (service `openrouter-api-key`; `OPENROUTER_API_KEY`
   is used only if that item is missing) and never prints it. It retries 429/500/502/503/504/524/529
   with backoff, and a batch stops sending after the first 401/402/403.
   Batch prints a Markdown table (answer + confidence per cell, plus the runner-up option or level when
   it holds ≥ 0.25) and a summary line with items, wall time, average latency, input tokens, cost,
   model version and route. Full answers with all probabilities, usage and per-item errors are in the
   results file.
5. **Read the answers.** Apply rule 2. For ranking, sort by `score` (degree) or by a `noul`
   (probability of a yes/no), never by confidence. When a runner-up shows in the cell, mention it.
6. **Write the deliverable** (this is Claude's job): a table or grouped list with Jev's verdict and
   number per item, the unsure items called out with "my call", and a footer with the summary line's
   totals (items, time, cost) and the model version.
7. **If answers look wrong on obvious items**, the question is the problem: Jev is literal. Tighten
   the wording, add boundary cases or examples to the criteria (examples only help when they look like
   the real items), re-run, and re-check on items you did not use as examples. Do not add reasoning
   steps. If the API rejects the request, show the exact error verbatim (the batch table shows the
   error body; the results file holds the full text) and re-check `reference.md` / the docs.

## Files

- `scripts/jev.py`: `ask` (one state; `--json`) and `batch` (many states, concurrent; `--out`,
  `--concurrency`, `--show-request-all`); both take `--show-request`, `--model`, `--session-id`.
- `reference.md`: endpoint, request/response shapes, limits, prices, errors, question-writing rules.
- `examples/sales-email.*.json`: the verified 2026-09-22 test (state, questions, real response). Lives
  only in the laptop copy; not committed here.

Commands above run from the repository root. This repo copy is for cloud sessions; the laptop keeps
its own under `~/.claude/skills/jev/`.

## Setup and troubleshooting

- Cloud sessions (claude.ai/code): there is no Keychain, so the script reads `OPENROUTER_API_KEY`
  only. Set it in the cloud environment's settings (environment menu in the session title bar, Edit),
  and allow `openrouter.ai` under Network access. Both take effect in a new session. Never paste the
  key into chat.

- Key: macOS Keychain item `openrouter-api-key` (account = login user). To (re)store it, copy the key
  to the clipboard and run
  `security add-generic-password -a "$USER" -s openrouter-api-key -U -w "$(pbpaste | tr -d '[:space:]')"`.
  Never paste the key into a file, a prompt, or chat, and never echo it back. The Keychain item wins;
  `OPENROUTER_API_KEY` is a fallback for when the item is missing. If the Keychain is locked or shows an
  access prompt, the script says so after 20 s: unlock it or choose "Always Allow", then retry.
- `401 Missing Authentication header`: the stored value is not shaped like a key (real ones start with
  `sk-or-v1-`, ~73 chars). `401 User not found.`: right shape, but not a valid or active key. The
  script's 401 message says which source (env or keychain) it used.
- `404` on the route: OpenRouter moved the alpha endpoint. Check the OpenRouter docs page named in
  `reference.md` and update `URLS` in `scripts/jev.py`.
- `402`: OpenRouter credits are exhausted. `429`/`524`/`529`: rate limit, timeout, or overload; the
  script already backs off; wait and re-run the failed ids. A re-run overwrites the results file unless
  you pass a new `--out`.

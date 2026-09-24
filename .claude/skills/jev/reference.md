# Jev reference (typesafe/jev-1.13 via OpenRouter): verified 2026-09-22

Source of truth: https://docs.typesafe.ai/llms.txt (Mintlify: add `.md` to any page path) and
https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request.
Re-read them if a request fails validation: the OpenRouter route is alpha and can move.

## Endpoint (OpenRouter)
POST https://openrouter.ai/api/alpha/decisions          ← the only documented route
Authorization: Bearer <OpenRouter key>      Content-Type: application/json
`scripts/jev.py` also tries https://openrouter.ai/api/v1/alpha/decisions if the first 404s; that path is
an unverified guess, and a 404 is reported for the documented route.
Native TypeSafe endpoint (not used here, different key): POST https://api.typesafe.ai/v1/systemone

## Request
{ "model": "typesafe/jev-1.13", "state": <string | object | array>, "questions": { "<id>": <Question>, ... },
  "session_id"?: string (≤256), "user"?: string (≤256) }
- `state`: the text to judge. Use an object with named fields when there is more than one piece
  (e.g. {"email": {...}}), then point questions at fields with backticks: "Does `email` ...".
- Question ids are yours; the model never sees them. Write the full question in `instructions`.
  Option names (choice keys) and the field names inside structured instructions/criteria ARE shown to
  the model, so name them meaningfully.
- `instructions` and every criteria value may be a string, an object, or an array (structure is understood).

Question shapes:
  choice: {"type":"choice","instructions":"...","criteria":{"option":"description or null", ...}}   1–255 options
  score:  {"type":"score", "instructions":"...","criteria":["level 0 (low)", "...", "level N (high)"]}  2–10 levels, ordered
  noul:   {"type":"noul",  "instructions":"yes/no question or statement","criteria"?:{"true":"...","false":"..."}}

## Response (real example in examples/sales-email.response.json)
{ "id": "gen-dec-…", "model": "typesafe/jev-1.13-20260917", "provider": "TypeSafe",
  "answers": {
    "<choice id>": {"type":"choice","choice":"option","probabilities":{"option":p,...},"confidence":c},
    "<score id>":  {"type":"score","score":x,"legend":{"0":"...","1":"..."},"probabilities":{"0":p,...},"confidence":c},
    "<noul id>":   {"type":"noul","noul":p} },
  "usage": {"input_tokens":n,"output_tokens":n,"cost":usd} }
- `_latency_ms` / `_route` in `jev.py ask --json` output and in the example file are added by the script.
- choice.confidence / score.confidence: 0–1, derived from how peaked `probabilities` is. It describes the
  answer's distribution, not its correctness. Noul has no confidence; its single number is both the answer
  and the certainty (near 0.5 = unsure), and it is a probability of "yes", not a degree of anything.
- score is the probability-weighted position on 0..N; it can land between levels. Round to the nearest
  level for a label; read `probabilities` to tell "solidly level 1" from "split between 0 and 2".
- Every question is judged independently against the same state; one answer never informs another.

## Limits, price, speed (from docs + our tests)
- 64k tokens per request (state + all questions); 32k for state + the longest question.
- Billed on input tokens only: $0.042 per million (output free). A 3-question, ~880-token item: $0.000037.
- Measured 2026-09-22 from this Mac, n=11 requests: 313–450 ms each (avg ≈ 370 ms); 6 items concurrently
  finished in 0.5 s wall.
- Rate limits are dynamic (429 → back off). The script retries 429/500/502/503/504/524/529 with backoff
  (1 s, 2 s, or the Retry-After header if larger) and a batch stops after the first 401/402/403.
- Text only. English is best; Spanish and other languages work with lower accuracy (docs: test on your
  own content first).

## Errors
OpenRouter returns: 400 invalid request (may or may not name the field) · 401 bad key ("Missing
Authentication header" = malformed, "User not found." = well-formed but invalid) · 402 no credits ·
413 too large · 429 rate limit · 502/529 provider error · 503 unavailable · 524 timed out.
TypeSafe-native codes (only if calling api.typesafe.ai directly): 422 validation, 529 overloaded.

## Writing questions that Jev answers well (from docs/model-jaggedness/jev-1.13 and the primitives pages)
- One snap judgment per question. Split multi-part judgments; combine in code/by hand.
- Jev is literal: write the exact condition. Put boundary cases in the criteria. Instructions and criteria
  must agree (no true=no / false=yes inversions, no double negatives).
- Choice: describe each option so they separate from each other; add `other` / `none_of_the_above`.
  Give the full list, not a shortlist.
- Score: describe situations, not degrees ("broken but a workaround exists" beats "moderate"). Levels are
  judged individually, so numbers or "worse than the previous level" mean nothing. One dimension per Score.
- Noul: phrase so that high = yes. Add true/false criteria when the boundary is subtle. Use a Score, not a
  Noul, for "how much".
- Not a calculator: no counting, arithmetic, date comparison, or numeric precision. Do that in code.
- Context rot: send only what the question needs. Filter long documents first.
- Avoid indirection: no property-of-a-property or multi-hop questions; point at the exact field by path.
- Adversarial text can steer it (it does not treat state as hostile). Be explicit in criteria.
- It cannot generate text. Extraction = give it candidates and let it pick (Choice).
- Don't carry a threshold tuned on a Noul to a Choice; P(yes) and 1−P(not-yes) are not guaranteed to agree.
- Examples inside criteria help only when they resemble the real items; a higher confidence after a
  rewording does not prove the answer got better. Re-check on items you did not use as examples.
- Batch: put every question you might need for one item in ONE request (they run in parallel; extra
  questions cost only their tokens). One request per item; run items concurrently (scripts/jev.py batch).

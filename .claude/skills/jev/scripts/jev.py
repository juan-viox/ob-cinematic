#!/usr/bin/env python3
"""jev.py: ask TypeSafe Jev (typesafe/jev-1.13) through OpenRouter's alpha "decisions" route.

Jev does not write. It answers typed questions about a piece of text ("state"):
  choice  → picks one option from a list           (+ probabilities, confidence)
  score   → places the text on an ordered scale     (+ probabilities, confidence)
  noul    → probability (0–1) that a statement is true

Key: macOS Keychain item  service=openrouter-api-key. The env var OPENROUTER_API_KEY is used only
when the Keychain item is missing, or always when not on a Mac (cloud sessions have no Keychain).
The key is read at send time and is never printed or written.

Usage:
  jev.py ask   --state-file state.json | --state "text"   --questions q.json [--json] [--show-request]
  jev.py batch --items items.json --questions q.json [--out results.jsonl] [--concurrency 6]
               [--show-request | --show-request-all]
    items.json = JSON array. An element whose keys are exactly {"id", "state"} (or just {"state"}) is an
    envelope: its "state" is sent and "id" labels the row. Any other element is sent as-is and labelled
    by its position. Ids must be unique.
    batch prints a Markdown table + a summary line (model, route, wall time, latency, tokens, cost) and
    writes one JSON line per item (full answers, usage, latency, or the full error) to --out
    (default: <items minus .json>.results.jsonl, overwritten on every run).
Common options: --model (default typesafe/jev-1.13), --session-id
Exit codes: 0 ok · 2 usage/input error · 3 no usable key · 4 API error (body printed verbatim) · 5 network error
"""
import argparse, http.client, json, math, os, subprocess, sys, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

URLS = ["https://openrouter.ai/api/alpha/decisions",      # the documented route (OpenRouter docs, 2026-09)
        "https://openrouter.ai/api/v1/alpha/decisions"]   # unverified guess, tried only if the first 404s
DEFAULT_MODEL = "typesafe/jev-1.13"
KEYCHAIN_SERVICE = "openrouter-api-key"
RETRY_STATUSES = (429, 500, 502, 503, 504, 524, 529)
FATAL_STATUSES = (401, 402, 403)   # batch stops sending after the first of these
RUNNER_UP_SHARE = 0.25             # a second option/level with at least this probability is shown


class JevError(Exception):
    def __init__(self, kind, status, url, body):
        super().__init__(f"{kind} {status} from {url}: {body}")
        self.kind, self.status, self.url, self.body = kind, status, url, body


def _fail(msg, code):
    sys.stderr.write(msg.rstrip("\n") + "\n"); sys.exit(code)


def load_json(path, what):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        _fail(f"{what}: {e}", 2)


def get_key():
    """Returns (key, source); source is 'keychain' or 'env'. Exits 3 when nothing usable is found.
    The value is shape-checked so it can never reach an http.client error message."""
    key, source = None, None
    if sys.platform == "darwin":               # no Keychain off a Mac (cloud sessions): env var only
        key, source = _keychain_key()
    if key is None:
        env = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if env:
            key, source = env, "env"
    if key is None:
        if sys.platform == "darwin":
            _fail("No OpenRouter key found. Copy the key to the clipboard, then store it once with:\n"
                  "  security add-generic-password -a \"$USER\" -s openrouter-api-key -U -w \"$(pbpaste | tr -d '[:space:]')\"\n"
                  "(nothing is echoed)", 3)
        _fail("No OpenRouter key found. Set OPENROUTER_API_KEY in the cloud environment's settings "
              "(environment menu, Edit), then start a new session. Never paste the key into chat.", 3)
    if not key.isascii() or any(c.isspace() or not c.isprintable() for c in key):
        _fail(f"the {source} key contains whitespace or control characters; re-store it (see --help)", 3)
    return key, source


def _keychain_key():
    """macOS only. Returns (key, 'keychain') or (None, None); exits 3 if the Keychain hangs."""
    key, source = None, None
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                             capture_output=True, text=True, timeout=20)
        if out.returncode == 0 and out.stdout.strip():
            key, source = out.stdout.strip(), "keychain"
        elif out.returncode != 0 and "could not be found" not in out.stderr:
            sys.stderr.write(f"keychain: {out.stderr.strip()[:200]}\n")
    except subprocess.TimeoutExpired:
        _fail("Keychain did not answer in 20 s: unlock the login keychain or approve the access prompt "
              "(choose 'Always Allow') and retry.", 3)
    except Exception as e:
        sys.stderr.write(f"keychain lookup failed: {type(e).__name__}\n")
    return key, source


def validate(questions):
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions must be a non-empty JSON object keyed by question id")
    for qid, q in questions.items():
        if not isinstance(q, dict):
            raise ValueError(f"{qid}: each question must be an object")
        t = q.get("type")
        if t not in ("choice", "score", "noul"):
            raise ValueError(f"{qid}: type must be choice|score|noul")
        if "instructions" not in q:
            raise ValueError(f"{qid}: missing instructions")
        c = q.get("criteria")
        if t == "choice" and (not isinstance(c, dict) or not c or len(c) > 255):
            raise ValueError(f"{qid}: choice criteria must be an object with 1–255 options")
        if t == "score" and (not isinstance(c, list) or not 2 <= len(c) <= 10):
            raise ValueError(f"{qid}: score criteria must be an ordered list of 2–10 levels")
        if t == "noul" and c is not None and not isinstance(c, dict):
            raise ValueError(f"{qid}: noul criteria, if present, must be an object with true/false")


def post(body, key):
    """POST to OpenRouter. Returns (url, response_json, latency_ms). Raises JevError only.
    Retries RETRY_STATUSES with backoff (1 s, 2 s, or Retry-After if larger). On a 404 the fallback URL
    is tried; the error reported names both results."""
    data = json.dumps(body).encode("utf-8")
    first_404 = None
    for url in URLS:
        for attempt in range(3):
            req = urllib.request.Request(url, data=data, method="POST", headers={
                "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                "HTTP-Referer": "https://viox.ai", "X-Title": "Jev via Claude Code"})
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    ms = (time.perf_counter() - t0) * 1000
                    raw = r.read()
                try:
                    return url, json.loads(raw.decode("utf-8")), ms
                except (ValueError, UnicodeDecodeError):
                    raise JevError("HTTP", 200, url, f"non-JSON response: {raw[:300]!r}")
            except JevError:
                raise
            except urllib.error.HTTPError as e:
                try:
                    body_text = e.read().decode("utf-8", "replace").strip()
                except Exception:
                    body_text = "(unreadable body)"
                err = JevError("HTTP", e.code, url, body_text)
                if e.code == 404:
                    if first_404 is None:
                        first_404 = err
                    break                      # try the next URL
                if e.code in RETRY_STATUSES and attempt < 2:
                    wait = 2 ** attempt
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra and ra.strip().isdigit():
                        wait = max(wait, min(int(ra), 30))
                    time.sleep(wait); continue
                raise err
            except (urllib.error.URLError, OSError, http.client.HTTPException, TimeoutError) as e:
                raise JevError("network", 0, url, f"{type(e).__name__}: {getattr(e, 'reason', '') or ''}".strip(": "))
            except Exception as e:                      # never let a raw traceback (or the key) escape
                raise JevError("network", 0, url, f"unexpected {type(e).__name__}")
    if first_404 is not None:
        raise JevError("HTTP", 404, URLS[0], f"primary route 404, fallback route also 404\n{first_404.body}")
    raise JevError("network", 0, URLS[0], "no route succeeded")


def error_text(e, key_source=None):
    hint = ""
    if e.status == 401:
        hint = (f"\n(key source: {key_source}. 'Missing Authentication header' = malformed key; "
                "'User not found.' = well-formed but invalid key. The Keychain item is used first; "
                "OPENROUTER_API_KEY only when the item is missing.)")
    return f"{e.kind} error {e.status} from {e.url}\n{e.body}{hint}"


def num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else 0.0


def _conf(a):
    c = a.get("confidence")
    return f"{c:.2f}" if isinstance(c, (int, float)) and not isinstance(c, bool) else "?"


def fmt_answer(a, q):
    """Compact cell for the batch table; shows the runner-up when it holds ≥ RUNNER_UP_SHARE."""
    try:
        t = a.get("type")
        if t == "choice":
            probs = sorted(a.get("probabilities", {}).items(), key=lambda kv: -num(kv[1]))
            runner = f"; {probs[1][0]} {num(probs[1][1]):.2f}" if len(probs) > 1 and num(probs[1][1]) >= RUNNER_UP_SHARE else ""
            return f"{a['choice']} ({_conf(a)}{runner})"
        if t == "score":
            top = len(q["criteria"]) - 1
            probs = sorted(a.get("probabilities", {}).items(), key=lambda kv: -num(kv[1]))
            runner = f"; L{probs[1][0]} {num(probs[1][1]):.2f}" if len(probs) > 1 and num(probs[1][1]) >= RUNNER_UP_SHARE else ""
            return f"{float(a['score']):.2f}/{top} ({_conf(a)}{runner})"
        if t == "noul":
            return f"p={float(a['noul']):.2f}"
    except (KeyError, TypeError, ValueError, AttributeError):
        pass
    return json.dumps(a)


def show(resp, url, ms, questions):
    answers = resp.get("answers") or {}
    print(f"model: {resp.get('model')}   provider: {resp.get('provider', '-')}   route: {url}")
    print("-" * 78)
    for qid, q in questions.items():
        a = answers.get(qid)
        if not isinstance(a, dict):
            print(f"{qid}: (no answer returned)"); continue
        t = a.get("type")
        try:
            if t == "choice":
                probs = ", ".join(f"{k} {num(v):.2f}" for k, v in sorted(a.get("probabilities", {}).items(), key=lambda kv: -num(kv[1])))
                print(f"{qid} [choice] → {a['choice']}   confidence {_conf(a)}")
                print(f"    probabilities: {probs}")
            elif t == "score":
                top = len(q["criteria"]) - 1
                score = float(a["score"])
                legend = a.get("legend") or {}
                probs = ", ".join(f"L{k} {num(v):.2f}" for k, v in sorted(a.get("probabilities", {}).items(), key=lambda kv: int(kv[0])))
                print(f"{qid} [score] → {score:.2f} of 0–{top}   confidence {_conf(a)}")
                if abs(score - math.floor(score) - 0.5) < 1e-9 and 0 <= math.floor(score) < top:
                    lo = int(math.floor(score))
                    print(f"    exactly between levels {lo} and {lo + 1} (see probabilities)")
                else:
                    n = min(top, max(0, int(math.floor(score + 0.5))))
                    print(f"    nearest level {n}: {legend.get(str(n), q['criteria'][n])}")
                print(f"    probabilities: {probs}")
            elif t == "noul":
                print(f"{qid} [noul] → {float(a['noul']):.2f} probability that the statement is true")
            else:
                print(f"{qid}: {json.dumps(a)}")
        except (KeyError, TypeError, ValueError, IndexError):
            print(f"{qid}: {json.dumps(a)}")
    u = resp.get("usage") or {}
    cost = u.get("cost")
    cost_s = f"${cost:.6f}" if isinstance(cost, (int, float)) and not isinstance(cost, bool) else "not reported"
    print("-" * 78)
    print(f"latency: {ms:.0f} ms   tokens in/out: {u.get('input_tokens', '?')}/{u.get('output_tokens', '?')}   cost: {cost_s}")


def cmd_ask(args, questions):
    state = load_json(args.state_file, "--state-file") if args.state_file else args.state
    body = {"model": args.model, "state": state, "questions": questions}
    if args.session_id:
        body["session_id"] = args.session_id
    if args.show_request:
        print(json.dumps(body, ensure_ascii=False, indent=2)); return
    key, source = get_key()
    try:
        url, resp, ms = post(body, key)
    except JevError as e:
        _fail(error_text(e, source), 5 if e.kind == "network" else 4)
    if args.json:
        resp["_latency_ms"] = round(ms)          # added by this script, not an API field
        resp["_route"] = url
        print(json.dumps(resp, ensure_ascii=False, indent=2))
    else:
        show(resp, url, ms, questions)


def normalize_items(items):
    norm, seen = [], {}
    for i, it in enumerate(items):
        keys = set(it) if isinstance(it, dict) else set()
        if "state" in keys and keys <= {"id", "state"}:
            iid, st = str(it.get("id", i)), it["state"]
        else:
            iid, st = str(i), it
        if iid in seen:
            _fail(f"duplicate id '{iid}' at items {seen[iid]} and {i}", 2)
        seen[iid] = i
        norm.append((iid, st))
    return norm


def cmd_batch(args, questions):
    items = load_json(args.items, "--items")
    if not isinstance(items, list) or not items:
        _fail("--items must be a non-empty JSON array", 2)
    bodies = [(iid, {"model": args.model, "state": st, "questions": questions}) for iid, st in normalize_items(items)]
    if args.session_id:
        for _, b in bodies: b["session_id"] = args.session_id
    if args.show_request_all:
        for iid, b in bodies:
            print(f"### item {iid}"); print(json.dumps(b, ensure_ascii=False, indent=2))
        return
    if args.show_request:
        print(f"{len(bodies)} requests would be sent (--show-request-all prints every one). The first:")
        print(json.dumps(bodies[0][1], ensure_ascii=False, indent=2)); return
    key, source = get_key()
    out_path = args.out or (os.path.splitext(args.items)[0] + ".results.jsonl")
    stop = threading.Event()

    def run(pair):
        iid, body = pair
        if stop.is_set():
            return {"id": iid, "error": "skipped after an auth/credit failure on another item", "error_kind": "skipped"}
        try:
            url, resp, ms = post(body, key)
            return {"id": iid, "model": resp.get("model"), "route": url, "answers": resp.get("answers") or {},
                    "usage": resp.get("usage") or {}, "latency_ms": round(ms)}
        except JevError as e:
            if e.status in FATAL_STATUSES:
                stop.set()
            return {"id": iid, "error": error_text(e, source), "error_status": e.status, "error_kind": e.kind}
        except Exception as e:
            return {"id": iid, "error": f"internal {type(e).__name__}", "error_kind": "internal"}

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex:
        results = list(ex.map(run, bodies))
    wall = time.perf_counter() - t0
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            for r in results:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    except OSError as e:
        sys.stderr.write(f"could not write {out_path}: {e}\n")
    qids = list(questions.keys())
    print("| id | " + " | ".join(qids) + " | ms |")
    print("|" + "---|" * (len(qids) + 2))
    for r in results:
        if "error" in r:
            lines = r["error"].splitlines()
            body_line = lines[1] if len(lines) > 1 else lines[0]
            print(f"| {r['id']} | ERROR {r.get('error_status', r.get('error_kind'))}: {body_line} |" + " |" * len(qids)); continue
        cells = [fmt_answer(r["answers"][q], questions[q]) if q in r["answers"] else "-" for q in qids]
        print(f"| {r['id']} | " + " | ".join(cells) + f" | {r['latency_ms']} |")
    ok = [r for r in results if "error" not in r]
    failed = [r for r in results if "error" in r]
    print()
    if ok:
        cost = sum(num(r["usage"].get("cost")) for r in ok)
        tin = int(sum(num(r["usage"].get("input_tokens")) for r in ok))
        lat = [r["latency_ms"] for r in ok]
        print(f"items: {len(results)}  ok: {len(ok)}  failed: {len(failed)}  wall: {wall:.1f}s  "
              f"avg latency: {sum(lat) / len(lat):.0f} ms  input tokens: {tin}  cost: ${cost:.6f}  "
              f"model: {ok[0]['model']}  route: {ok[0]['route']}")
    else:
        print(f"items: {len(results)}  ok: 0  failed: {len(failed)}  wall: {wall:.1f}s")
    if failed:
        first = next((r for r in failed if r.get("error_kind") != "skipped"), failed[0])
        print(first["error"])
    print(f"results: {out_path}")
    if failed:
        sys.exit(5 if all(r.get("error_kind") in ("network",) for r in failed) else 4)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd")
    a = sub.add_parser("ask", help="one state, several questions")
    g = a.add_mutually_exclusive_group(required=True)
    g.add_argument("--state"); g.add_argument("--state-file")
    a.add_argument("--json", action="store_true", help="print the raw API response (+ _latency_ms, _route added by this script)")
    b = sub.add_parser("batch", help="many states (items), same questions, concurrent")
    b.add_argument("--items", required=True); b.add_argument("--out")
    b.add_argument("--concurrency", type=int, default=6)
    b.add_argument("--show-request-all", action="store_true", help="print every request body, then exit")
    for s in (a, b):
        s.add_argument("--questions", required=True)
        s.add_argument("--model", default=DEFAULT_MODEL)
        s.add_argument("--session-id")
        s.add_argument("--show-request", action="store_true", help="print the (first) request body, then exit; no key needed")
    args = p.parse_args()
    if args.cmd not in ("ask", "batch"):
        p.print_help(); sys.exit(2)
    questions = load_json(args.questions, "--questions")
    try:
        validate(questions)
    except ValueError as e:
        _fail(f"bad questions: {e}", 2)
    (cmd_ask if args.cmd == "ask" else cmd_batch)(args, questions)


if __name__ == "__main__":
    main()

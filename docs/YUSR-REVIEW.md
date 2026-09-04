# Yusr (يُسر) — Full Feature Review
2026-08-10 · reviewed: server/src/assist.js, assist.js (widget), assistcfg.js, api.js routes, index.html entry points, KB files

## What Yusr is
A local-LLM (Ollama) troubleshooting copilot for L1 / call-center agents. Intent router → context gatherer → LLM (or rule-based fallback when Ollama is unreachable). Four surfaces: floating bubble on every page, "Ask Yusr" hint chips (Home, Troubleshoot, Alerts, Integrations), Settings → Yusr config panel, and `POST /api/assist/chat` behind the session auth gate.

## What is genuinely good (keep as-is)
- **Architecture**: intent routing keeps out-of-scope prompts away from the LLM entirely; alerts answered from live alert data only (can't hallucinate incidents from runbook text); smalltalk never costs an LLM round-trip.
- **PII governance**: context is masked with `roles.maskDeep` per the CALLER's capabilities *before* the LLM sees it — masking happens on the structured object, then the pack is built. The model can only see what the agent may see. System prompt explicitly forbids guessing masked values.
- **Privacy**: everything stays on-network (local Ollama); audit log records intent + degraded flag, not the question text.
- **Graceful degradation**: Ollama down → rule-based answers from the same gathered context, flagged `degraded`.
- **Existing-subscriber handling**: a number with failures/CST tickets but no onboarding order returns a lightweight pack instead of "not found".
- **Config safety**: config/ping endpoints gated by `manageSync` cap; `/api/assist/enabled` exposes only the on/off flag; timeouts clamped 5–120 s.

## Defects found (all FIXED in this pass)
1. **The Integrations page's own button was refused.** The page ships an "Ask Yusr → Explain the integration …" chip, but `integration` wasn't in the topic regex and the KB had no integrations content → canned refusal (seen live in the screenshot). Fixed three ways: (a) `integration` + all system names (oracle/bss/absher/hyperpay/tamara/merchalink/couriers/zatca/…) added to CUSTOMER_TOPICS; (b) new `INTEGRATIONS.md` KB file auto-generated from the page's own `data.js` catalog (32 systems, one KB chunk each) and added to KB_FILES; (c) system-prompt scope now includes explaining integrations/webhooks/workers.
2. **Arabic questions were refused.** The topic regex was English-only, so «لماذا فشل الدفع» → out-of-scope, for a call-center tool. Added an Arabic topic regex (مشترك/دفع/تفعيل/شريحة/نفاذ/توصيل/…).
3. **Hard refusals on unanticipated phrasing.** The keyword regex acted as a whitelist. Now out_of_scope first probes the KB + error-code catalog; a hit reroutes to knowledge. The regex remains as a gate for clearly off-topic questions, which still never reach the LLM.
4. **Real MSISDN hardcoded in the greeting** ("Check subscriber 0581416290") — a real-looking number in the shipped UI that every curious click would look up. Replaced with the `05…` template.
5. **Suggestion chips auto-sent templates.** Clicking "Check subscriber 05…" sent the incomplete text (→ refusal). Chips ending in "…" now prefill the input for the agent to complete; others still send immediately.
6. **Status line lied.** Header said "Online · troubleshoot faster" unconditionally — including on 152 where Ollama is not installed and every answer is the degraded fallback. Now it reflects the last reply: "Data-only mode · LLM offline" vs "Online".

## Known limitations (accepted, documented)
- **On server 152 Yusr runs in permanent degraded mode** until Ollama (~5 GB llama3.1) is hand-carried in (no internet on 152). The fallback answers are real data (profile, failures, CST tickets, alert list, runbook titles), just not conversational. The status line now says so honestly.
- **KB coverage** = OPS_RUNBOOK, UPG_PAYMENT_MONITORING, INTEGRATIONS (all mounted → edit without rebuild; 5-min cache). Newer runbook-worthy topics (BSS 1500 two-paths, Semati canary, courier backlog) are not yet written up as runbooks — worth adding as .md when time permits.
- `INTEGRATIONS.md` is generated from `data.js`; regenerate if the Integrations page data changes (one-liner in the review notes / deploy kit).

## Recommendations (not yet implemented — decide later)
- **Rate limiting**: `/api/assist/chat` has no per-user throttle; a customer-intent question triggers a 14-day feed scan (~2 s) + subscriber profile. Fine for a small team; add a simple per-session limiter if usage grows.
- **Ollama URL validation**: an admin can point `ollamaUrl` at any URL and chat context (masked per caller) is POSTed there. Cap-gated and 152 has no egress, so low risk — but validating http(s) + private-range would harden it.
- **`detail` strings in `recent_failures`** may embed identifiers inside free text; `maskDeep` masks known keys, not substrings. Low risk (caller already sees the same feed unmasked per role), but a regex pass over detail strings would close it.
- **Prompt injection**: subscriber trace request/response text reaches the prompt. Low stakes (local model, masked data, read-only answers) — no action needed now.
- **Status on open**: header could ping once when the panel opens (currently updates after the first reply); `/api/assist/ping` is admin-gated, so it would need a public lightweight variant.

## Verification (after deploy)
1. Integrations page → "Ask Yusr" chip → complete "Explain the integration Nafath" → real explanation citing `INTEGRATIONS.md › Nafath / IAM` as source (no refusal).
2. Ask «لماذا فشل الدفع للعميل؟» → routed to knowledge (UPG runbook), not refused.
3. Greeting chip "Check subscriber 05…" → prefills, does not send. No real MSISDN anywhere.
4. On 152 (no Ollama): reply arrives with "⚠ LLM offline" note and header flips to "Data-only mode · LLM offline".
5. "What incidents are open?" → answers from live alerts only.

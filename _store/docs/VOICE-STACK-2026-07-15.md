# Voice stack investigation — 2026-07-15

Client report (Daniel, after a phone test from a taxi):

> Звук постоянно скачет — то громче, то тише.
> Когда я спрашиваю про DAN'S sprayer, ИИ сильно тупит и не понимает запрос.
> Мне пришлось говорить: "DAN'S, spell D-A-N-apostrophe-S".
> Посмотрите последний кейс (голосовые разговоры с +61410609617).

Three complaints, three *different* root causes. Evidence below, then what was changed,
then how to undo each piece independently.

---

## 1. "Звук скачет" (volume swings) — NOT REPRODUCIBLE. Nothing changed.

Downloaded ElevenLabs' own recordings of two of Daniel's calls
(`GET /v1/convai/conversations/{id}/audio`) and measured them with ffmpeg EBU R128:

| call | agent turns | integrated loudness spread | LRA within sustained speech |
| --- | --- | --- | --- |
| f0e8cb0a (2026-07-02, 77s) | 5 | **2.6 LU** (−18.7 … −21.3 LUFS) | 1.7 – 3.9 LU |
| 104bf396 (2026-06-30, 106s) | 4 | **0.9 LU** (−20.2 … −21.1 LUFS) | 3.3 – 5.7 LU |

That is broadcast-clean. Just-noticeable difference is ~1 LU; "constantly jumping" would
show as 8–15+ LU. Whole-call LRA looks high (10–12 LU) but that is just agent (−20) vs
Daniel (−25) vs silence — not agent instability.

**So the TTS is not the cause, and tuning `stability`/`style` would be tuning something
that already measures fine.** Deliberately left alone.

Where the swing can still come from, in order of suspicion:

1. **Format mismatch into Twilio.** `agent_output_audio_format: pcm_24000`,
   `user_input_audio_format: pcm_16000`, but Twilio Media Streams are μ-law 8 kHz — every
   frame is resampled. The recording measured above is ElevenLabs-side (16 kHz mono),
   captured *before* that transcode, so an artifact there is invisible to the measurement
   and audible to the caller.
   **Not changed, on purpose:** `agent_output_audio_format` is **not** in
   `platform_settings.overrides.conversation_config_override`, so it cannot be set
   per-call. Changing it would drop the **website widget** to 8 kHz telephone audio too —
   one agent serves both channels. Degrading the widget to chase an unreproducible bug is
   a bad trade.
2. **`optimize_streaming_latency: 3`** — level 3 maximises latency optimisation at the
   cost of quality and disables the text normaliser. Affects the live stream, not
   necessarily the rendered recording.
3. **Cellular in a moving taxi** — AMR rate adaptation, AGC, tower handovers. Daniel means
   the taxi was *acoustically* quiet; he cannot perceive RF conditions. Fits the symptom
   exactly and cannot be ruled out.

**Next step:** have Daniel re-test **stationary, on wifi/VoIP if possible**. If it persists
stationary it is ours (try 1 and 2, in that order, on a scheduled window). If it only
happens in the taxi, it is the network.

## 2. "DAN'S sprayer — ИИ тупит" — TWO root causes, both fixed

### 2a. No ASR keyword biasing → the word never arrived

`asr.keywords` was `[]`. "DAN'S" is an invented brand; a generic speech model has never
seen it. Measured from Daniel's real calls:

| what he said | what Scribe heard |
| --- | --- |
| DAN'S paint sprayer | **"Dense, uh, paint sprayer"** |
| DAN'S Airless Backpack | **"Sponsored Defense Backpack"** |
| Chatswood (our own demo suburb) | **"Chatsworth"** |
| (unclear) | **"Chinese"** |

One call *did* transcribe "Dan's backpack" correctly — inconsistent, not broken, which is
the classic signature of missing biasing. This is why he had to spell it out loud. The AI
was not being stupid; it never received the word.

**Fixed:** `asr.keywords` now carries 33 terms (brands, product lines, trade jargon,
Chatswood). See `_store/setup/tune-voice-stack.js`.

### 2b. The knowledge base was never indexed → the answer was unreachable

`rag.enabled: true`, but **every** attached KB doc returned `{"indexes":[]}` — nothing had
ever been embedded.

| doc | mode | chars | indexed? |
| --- | --- | --- | --- |
| Product Knowledge & Painting Guides | auto | 8,444 | no |
| Paint Sprayers Trouble-Shoot | auto | 30,593 | no |
| Conversation & Estimation Logic paint calculation | auto | 16,871 | no |
| **Product Recommendation Details** (contains `## DAN'S Spray / DAN'S Paint Spray`) | auto | 5,141 | no |
| Excluded Products & Restrictions | prompt | 2,949 | n/a — always in context |
| Company Information | prompt | 993 | n/a |
| Product Recommendation Rules | prompt | 4,817 | n/a |
| Bot Behavior Rules | prompt | 3,460 | n/a |

`auto` docs are reachable **only** via RAG. Their total (61,049 chars) also exceeds
`rag.max_documents_length` (50,000), so they cannot be stuffed into context as a fallback.

**The agent had never seen 61,049 characters of its own knowledge base** — the entire
DAN'S product section, the 30k troubleshooting guide, and the paint-calculation logic.

And the always-loaded `Product Recommendation Rules` says:

> `- DAN'S Spray, Dance Spray, DAN'S paint spray -> use Product Recommendation Details.`

…pointing the agent at a document it could not reach. A dangling pointer in the brain.
This is the direct answer to "we have the full DAN'S description in the KB, why doesn't it
find it?" — and a large part of *why* the codebase grew regex/product-search workarounds:
the knowledge layer was dead, so reflexes were bolted on outside it.

**Fixed:** `_store/setup/build-kb-rag-index.js` builds embeddings for the four `auto` docs.
Additive and non-destructive — it computes embeddings, it does not touch document content.

## 3. "Задержки" (delays) — root cause fixed, and it was coupled to #2

Measured reply latency (end of Daniel's turn → start of agent's):

| call | median | max |
| --- | --- | --- |
| 2026-07-02 | **6 s** | 7 s |
| 2026-06-30 | **8 s** | 11 s |
| 2026-06-25 | 5 s | **13 s** |

`turn.turn_timeout` was **7** — the agent waited up to 7 seconds of silence before
deciding he had finished. The medians match it almost exactly ("Hello?" → 7s → reply).

It is **coupled to 2a**: when the ASR is mangling input and the caller is hesitant ("Um,
can I have a look then, um…"), semantic turn detection can't confidently find end-of-turn
and falls back to the full timeout. Fixing the keywords should improve latency on its own.

`soft_timeout_config.timeout_seconds` was **−1 (disabled)**, so that wait was dead silence
— as were tool calls (one call had **6 agent turns with no speech at all**).

**Fixed:** `turn_timeout` 7 → 3; soft-timeout fillers enabled at 2s with a sensible message
("One sec, just checking that for you." — the previous configured-but-disabled message was
"Hhmmmm...yeah.").

---

## Bonus: the TTS block in `update-agent.js` is fiction

Three ways, and it misleads anyone who reads it:

- **`style: 0` and `use_speaker_boost: true` are sent but silently dropped** — neither
  appears in the live config; they are not part of ConvAI's TTS schema. The comment
  describes careful voice tuning that **does not exist live**.
- **`optimize_streaming_latency`** — the comment says *"intentionally NOT set… IGNORED by
  the Conversational AI agent runtime."* It is **live at 3**.
- `model_id` is assigned **twice** in the same object literal.

Same class as the prompt drift documented elsewhere: the code asserts a reality the API
does not honour. Left in place for now (changing TTS is out of scope until the audio
re-test), but do not trust those comments.

---

## What changed, and how to undo each piece

| # | Change | Where | Undo |
| --- | --- | --- | --- |
| 1 | `asr.keywords` [] → 33 terms | `tune-voice-stack.js` | `node tune-voice-stack.js --revert _store/setup/voice-stack-backups/before-*.json` |
| 2 | `turn_timeout` 7 → 3 | `tune-voice-stack.js` | same revert file (reverts asr + turn together) |
| 3 | soft timeout −1 → 2s + message | `tune-voice-stack.js` | same revert file |
| 4 | RAG index built for 4 `auto` docs | `build-kb-rag-index.js` | `DELETE /v1/convai/knowledge-base/{id}/rag-index?model=e5_mistral_7b_instruct` per doc; or just leave it — an unused index is harmless |
| — | audio format / stability | **not changed** | n/a |

Every `--commit` run of `tune-voice-stack.js` snapshots the live "before" values to
`_store/setup/voice-stack-backups/` first, and verifies afterwards that each field actually
persisted (the API silently drops unsupported fields — see the `style` case above).

## How to tell if it worked

Ask Daniel for one test call, **stationary**, and check:

1. Say "DAN'S sprayer" **without** spelling it → should be recognised. (`asr.keywords`)
2. Ask something only the KB knows, e.g. "what's in the DAN'S Airless Backpack kit?" →
   should answer from Product Recommendation Details rather than deflecting. (RAG index)
3. Short replies ("Hello?", "Okay") → should come back in ~2-3s, not 6-8s. (`turn_timeout`)
4. During a product search → should hear a filler, not silence. (soft timeout)
5. **Volume**: if it is still unstable while stationary, it is ours — go to §1 step 1.
   If it is stable stationary and only bad in the taxi, it was the cellular link.

Verify config from the repo at any time:

```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app\_store\setup"
node build-kb-rag-index.js --status   # every auto doc should say succeeded
node tune-voice-stack.js              # dry run: prints live values vs intended
```

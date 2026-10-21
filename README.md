# CareCircle

**A voice-first care companion that helps families look after the people they love.**
An older person talks to Alexa+. Their family sees what matters on a dashboard. A family admin manages the care plan.

Built for the *Build, Ship, Shape: Amazon Developer Hackathon* (Alexa+ track), with an [MCP](https://modelcontextprotocol.io) server as the Alexa+ integration surface.

![license](https://img.shields.io/badge/license-MIT-green)

---

## What it does

| Who | What they get |
|---|---|
| **The person in care** | Talks naturally (English, Hindi, Hinglish, Tamil, Telugu, Bengali, Kannada). Logs doses, mood, sleep, pain and readings by voice. Gets short, warm replies. |
| **Family members** | A live dashboard per person: adherence, mood and sleep trends, vitals, appointments, alerts, a weekly digest, and an "ask about…" chat. |
| **Family admins** | A Manage console: add or remove people, change medicines, care instructions, facilities and appointments, and **add medicines from a photo of a prescription** (reviewed before anything is saved). |
| **Clinicians** | Read-only access to the patients assigned to them, across families. |

Highlights:

- **Autonomous care watch**: reviews the whole record and decides whether the family needs to know.
- **Condition-aware signals**: low oxygen, low sugar, rapid weight gain, abnormal pulse, INR out of range, and compound decline.
- **Deterministic emergency handling**: after an urgent alert the server speaks a fixed, translated 112 / 108 message. The model never improvises it.
- **Multi-family data**: 6 synthetic families, 10 patients and 29 accounts with different conditions.
- **Roles, tenant isolation, audit log, chat history with retention.**

How it is built, where a language model is used and where it deliberately isn't: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> **Note on Alexa+:** the "Echo" screen in the web app is a simulator that talks to CareCircle's own MCP server (`/mcp`), the same way Alexa+ would. All data is synthetic. CareCircle does not give medical advice.

---

## Quick start

**Requirements:** Python 3.13+, [uv](https://docs.astral.sh/uv/), Node 20+, and an Amazon Bedrock API key (Bedrock console → API keys) with access to the model below.

```bash
git clone <this repo> carecircle && cd carecircle

# 1. configuration
cp .env.example .env          # then put your key in .env (AWS_BEARER_TOKEN_BEDROCK=...)

# 2. backend dependencies
uv sync

# 3. build the web app (the server serves web/dist)
cd web && npm ci && npm run build && cd ..

# 4. run
uv run carecircle             # http://localhost:8000
```

Open <http://localhost:8000> and press **Start the demo**: Asha signs in on her Echo and Rohan (family admin) on his phone, side by side.
The sign-in page also lists every demo account and password (`<FirstName>_2026`; clinicians `<Surname>_2026`).

To pin the medicine schedule to a fixed time of day for a repeatable demo:

```bash
CARECIRCLE_DEMO_TIME=09:00 uv run carecircle
```

### Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key | required for the assistant |
| `AWS_REGION` | Bedrock region | `ap-southeast-2` |
| `CARECIRCLE_MODEL_ID` | Model or inference profile id | `au.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `CARECIRCLE_VISION_MODEL_ID` | Model for prescription reading | same as above |
| `CARECIRCLE_DEMO_TIME` | Pin the care clock to `HH:MM` | real time |
| `CARECIRCLE_POLLY_*` | Optional server voice (Amazon Polly); off unless set | off |

`.env` is git-ignored. Never commit it.

### Developer view

The footer has a **Show developer view** link. It reveals the live MCP traffic, the architecture panel and (for family admins) system details. It is off by default so the product UI stays clean.

---

## Tech stack

| Layer | Technology |
|---|---|
| Integration | **MCP** spec 2025-11-25, Streamable HTTP (FastMCP, `mcp>=1.23,<2`) |
| Agent | **Strands Agents SDK** on **Amazon Bedrock** (Claude Haiku 4.5) |
| API | FastAPI, Server-Sent Events |
| Storage | SQLite |
| Web | React 19, Vite, TypeScript, Tailwind v4, Framer Motion, Recharts |
| Voice | Web Speech API; optional Amazon Polly |

---

## Tests

```bash
uv run pytest                        # backend: care rules, RBAC, tenant isolation, audit, admin, prescriptions, safety
cd web && npm test                   # components (Vitest + Testing Library)
cd web && npm run e2e                # end-to-end (Playwright on a real server and a throwaway database)
uv run python -m evals.run           # live behaviour evals against the real model (needs the Bedrock key)
uv run python -m evals.prescription_eval
```

The live evals are probabilistic: they assert behaviour (which tool was called, which severity was raised), not exact wording.
`evals/make_samples.py` regenerates the sample prescription images used by the prescription evals (needs the dev dependency Pillow).

---

## Project layout

```
src/carecircle/
  app.py          REST + SSE + static hosting, request context and permission checks
  mcp_server.py   the MCP server: 13 tools, a resource and a prompt, auth middleware
  agent.py        the conversational agent, prompts, languages, emergency override
  service.py      care logic: doses, check-ins, vitals, signals, alerts
  admin.py        family-admin operations
  prescription.py prescription reading and checking
  auth.py         roles, permissions, tokens, login
  audit.py        append-only audit trail
  db.py, seed_data.py, passwords.py, tts.py
web/              React app (src/, unit tests beside the code, e2e/)
evals/            live model evals and sample generator
docs/             architecture and code walkthrough
```

---

## Limits (demo scope)

- Demo sign-in shows passwords on the page. A real deployment would use Alexa+ account linking (OAuth 2.0 + PKCE).
- SQLite, no encryption at rest, no rate limiting, no TLS termination.
- Clinical thresholds are simple demo rules, not medical advice.
- Prescription reading is tested on printed and photographed Latin-script documents, not handwriting.
- Of the supported languages, Alexa+ in India currently covers English, Hindi and Hinglish; the others are simulated.

## License

MIT. See [LICENSE](LICENSE).

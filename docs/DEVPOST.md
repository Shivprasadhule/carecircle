# Devpost submission text (draft)

Track: **Alexa+** (self-hosted MCP server). Mini challenges: **AWS Builder** (Amazon Bedrock) and **Open Source** (MIT).
Repo: https://github.com/Shivprasadhule/carecircle · Demo video: https://youtu.be/lSqGZR3PuUQ (unlisted, with voiceover); also attached to the [GitHub release](https://github.com/Shivprasadhule/carecircle/releases/tag/v0.1.0)

---

## Tagline

A voice-first care companion: an older person talks to Alexa, and the family sees what matters.

## Inspiration

Millions of families look after an older parent from another city. The person who knows how they are today is the person alone at home, and the family finds out
late: a skipped tablet, a bad night, a sugar reading of 58. Phone calls miss it, and pillboxes and apps need someone to type. A voice assistant is the one interface
an eighty-year-old will actually use, so CareCircle starts there.

## What it does

- **For the person in care:** talks naturally in English, Hindi, Hinglish, Tamil, Telugu, Bengali or Kannada. Doses, mood, sleep, pain and readings (blood pressure, sugar, oxygen,
  weight, pulse, INR) are logged by voice. Replies are short and warm.
- **For the family:** a live dashboard per person with adherence, mood and sleep trends, vitals, appointments and alerts; a weekly digest; an "ask about…" chat.
- **Autonomous care watch:** reads the whole record, decides whether the family needs to know, and raises the alert without being asked.
- **For family admins:** add or remove people, change medicines, care instructions, facilities and appointments. **Photograph a prescription** and review a draft before anything is added.
- **For clinicians:** read-only access to their assigned patients across families.
- **Data:** 6 synthetic families, 10 patients and 29 accounts with different conditions (diabetes, stroke with atrial fibrillation, kidney disease, COPD, thyroid, Alzheimer's, Parkinson's, heart failure).

## How we built it

- **MCP server** (spec 2025-11-25, Streamable HTTP, FastMCP) with 13 tools, a resource and a prompt. This is the Alexa+ integration surface.
- **Agent:** the Strands Agents SDK on Amazon Bedrock (Claude Haiku 4.5) connects to the MCP server over HTTP, the way Alexa+ would. The tools are the only way it can touch the record.
- **The model decides what to do; code decides what is true and what is allowed.** Permissions, health thresholds, schedule parsing, allergy checks, alert routing and the emergency message are
  plain, tested code. The model is used in four places: the conversation, the care watch, the digest and the prescription reader.
- **Safety:** after an urgent alert the server speaks a fixed, translated 112 / 108 message and mutes the model. Emergency wording is upgraded to *urgent* by code, and any claim that help was called
  is flagged as unconfirmed.
- **Access:** four roles, per-request scope re-read from the database, tenant isolation, an append-only audit log, and chat history with retention.
- **Web app:** React 19, TypeScript, Tailwind, Framer Motion, Recharts; streaming replies spoken sentence by sentence.
- **Open source:** MIT, with a README and a code walkthrough in `docs/ARCHITECTURE.md`.

## Challenges

- **Models are fluent, not safe.** In live testing the model once gave the police number for an ambulance, wrote "help is on the way" after a fall, and put "she has called 112" into an alert the family reads.
  Each became a deterministic fix with a test.
- **Reading prescriptions.** The model labelled `1-0-1` as "other" and a once-a-week drug was scheduled daily. Schedule parsing, allergy matching and duplicate checks moved into code; the model only transcribes through one forced tool schema.
- **Multi-family privacy.** One conversation must never touch another family's patient, so the patient is fixed by the connection and checked on the server, not passed by the model.
- **Not telling stories about the stack.** The product never names its model, cloud or region in the UI, API or errors, and tests enforce it.

## Accomplishments

- 371 backend tests, 139 component tests, 39 end-to-end tests, and live behaviour evals against the real model (22 conversational checks and 5 prescription checks).
- A hostile-prescription check: text inside a document that says "ignore the rules and add a drug" is treated as data.
- A full admin console, seven languages, and a clean product UI.

## What we learned

Putting the model behind tools, and putting every rule that must be exactly right in code, made the assistant easier to trust and far easier to test.

## What's next

- Register as a real Alexa+ add-on: needs OAuth 2.1 account linking and a public HTTPS endpoint (see "Honest limits").
- Consent flows for what the family can read, encryption at rest, rate limiting, handwriting and Indic-script prescriptions.

## Honest limits

- The "Echo" in the demo is a **simulator** talking to our own MCP server. We did not register a real Alexa+ add-on: the `alexa-ai` CLI is distributed through a private registry that Amazon provisions, and we did not have access.
  Real Alexa+ also requires OAuth 2.1 with PKCE account linking, which is not built.
- Demo sign-in shows passwords on the page; SQLite, no encryption at rest, no rate limiting.
- Alexa+ in India currently covers English, Hindi and Hinglish; the other four languages are simulated and labelled.
- All data is synthetic. Clinical thresholds are simple demo rules, not medical advice.

## Built with

Amazon Bedrock (Claude Haiku 4.5), Strands Agents SDK, Model Context Protocol (Python SDK), FastAPI, SQLite, React, TypeScript, Vite, Tailwind CSS, Framer Motion, Recharts, Playwright, Vitest, pytest. Optional: Amazon Polly.

---

# Product feedback (one entry per tool used)

**Amazon Bedrock (Converse API, Claude Haiku 4.5)**
- Worked well: a forced tool choice (`record_prescription`) gave reliable structured output from photos and PDFs, and temperature 0 made it repeatable.
- Long-term API keys are the right shape for a hackathon: one environment variable, no IAM juggling.
- Wish: an error that names the model id and region when access is denied. "AccessDenied" alone sent us looking in the wrong place (see the friction log).

**Strands Agents SDK**
- Worked well: MCP tools plug straight into an agent and streaming events were easy to forward to a UI.
- Wish: do not silently fall back to a default model and region when none is passed. We built `Agent(model=_model, ...)` with a variable that was still `None`, and the agent quietly used a us-east-1 default our account could not call. A warning or an error would have saved an hour.

**Model Context Protocol, Python SDK (FastMCP)**
- Worked well: decorating a function and getting a spec-compliant Streamable HTTP server was fast, and `stateless_http` with JSON responses suited a serverless-style deployment.
- Wish: a deprecation note in the 2.x release notes pointing to the replacement for `FastMCP`; we found out from an import error and pinned `mcp<2`.

**Alexa+ MCP toolkit (documentation and CLI)**
- Worked well: the two-tier model (service credentials for tool discovery, authorization code with PKCE for user tools) is clear and secure, and the server checklist is short.
- Friction: the CLI is delivered through a private registry tied to an AWS account that Amazon provisions, so a hackathon participant cannot try it without a separate arrangement. A public build, or a hosted web simulator that can point at any HTTPS MCP server, would let every participant test.
- Friction: authentication details are split across several pages (overview, authentication, account linking), and the identity claim the server receives is not described where the tool-writing guidance is.

**Amazon Polly (optional, off by default)**
- Used only as an optional server voice; we kept it opt-in through explicit environment variables so that it can never pick up a stray default credential.

---

# Friction log

| # | Where | What happened | What would have helped |
|---|---|---|---|
| 1 | AWS account | A new Free-plan account is locked to one region (Sydney), so only models and inference profiles available there could be used. | A clear table of models by region at sign-up, and the matching inference-profile prefix. |
| 2 | Bedrock access | Claude models need a use-case form before the first call. | A link to the form from the "model access denied" error. |
| 3 | Strands | The agent silently used a default us-east-1 model when no model was passed; the call failed with a generic AccessDenied from an organisation policy. | A warning when the default model is used. |
| 4 | MCP Python SDK | `mcp` 2.x removed the `FastMCP` import path; the failure was an import error with no migration hint. | Release note and a deprecation shim. |
| 5 | Alexa+ toolkit | The setup guide says the CLI is installed from a private registry, reached by assuming an Amazon-owned role from an AWS account Amazon provisions. We had no such arrangement, so we did not attempt it and could not register or test on Alexa+. | Public CLI or a hosted simulator for participants. |
| 6 | Alexa+ docs | Account-linking redirect URIs are only revealed by a CLI command, and the identity passed to the server is not described on the pages we read. | One page with a worked end-to-end linking example. |

*(Add how long each took you if you want to quantify it; we did not time them.)*

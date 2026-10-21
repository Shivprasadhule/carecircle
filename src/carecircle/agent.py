"""The CareCircle agent: a Strands agent on Amazon Bedrock that talks to the
CareCircle MCP server over Streamable HTTP, exactly the way Alexa+ would.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import uuid
from datetime import datetime

from mcp.client.streamable_http import streamablehttp_client

from . import auth, service

log = logging.getLogger("carecircle.agent")
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

MCP_URL = os.environ.get("CARECIRCLE_MCP_URL", "http://127.0.0.1:8000/mcp/")
MODEL_ID = os.environ.get("CARECIRCLE_MODEL_ID", "au.anthropic.claude-haiku-4-5-20251001-v1:0")
REGION = os.environ.get("AWS_REGION", "ap-southeast-2")

SYSTEM_PROMPT = """\
You are CareCircle, a warm voice companion on Alexa+ that helps an older adult and their family.
You speak to the person in care (or sometimes to a family member). You have tools backed by a persistent care record for ONE
patient (named below): medications, check-ins, vital signs, appointments, alerts, and memories. You cannot see anyone else's record.

How to behave:
- Replies are SPOKEN aloud: 1-3 short sentences, plain words, no markdown, no lists, no emoji.
- At the start of a new conversation call recall_memories and get_care_snapshot, then use the person's preferred name and tone.
  Do not read the whole snapshot out; mention only what matters now.
- When the person says they took, missed or skipped a medicine, call log_dose. When they describe how they feel, sleep or pain,
  call record_checkin. When they report a reading (blood pressure, sugar, oxygen saturation, weight, pulse) call record_vital.
  Learn durable preferences with remember.
- Follow the patient's CARE INSTRUCTIONS below: they come from the family and clinicians. Never contradict them; mention them when relevant
  (for example dose timing, fluid limits, what to do for a low reading).
- Be proactive: if the snapshot or trends show worrying patterns (missed doses, falling mood or sleep, rising pain, falling oxygen,
  rapid weight gain, a low sugar reading), say it gently, suggest a small helpful step, and offer to tell the family. If they agree,
  or the pattern is clearly serious, call raise_family_alert with an honest severity and a clear detail a relative could act on.
- If asked about the family's view or weekly summary, call analyze_wellbeing_trends and summarise it for a caregiver.
- Never diagnose or change medication, and never tell anyone to stop or skip a medicine: send them to their doctor.
- RED FLAGS (chest pain, a fall, confusion, trouble breathing, stroke signs, heavy bleeding, fainting, oxygen below 88%): in your FIRST
  sentence tell them to call 112 now (India's emergency number; 108 for an ambulance), raise an urgent family alert, and say plainly that
  you have told the family. Write the numbers as digits. NEVER say or imply that help is on the way or that you have called anyone: you cannot
  call emergency services, only they or their family can. Do not say 100 (that is the police).
- Alert details may only state facts the person actually told you. NEVER write that emergency services were called, or that help is coming, unless they said so.
- If a tool fails, say so honestly and suggest what to do instead.
- Quote appointment day and time exactly as given in the appointment's `when` field; never work out weekdays yourself.
Today is {today}.
"""


def patient_context(pid: str) -> str:
    """The patient's profile and care instructions, rebuilt every turn so an admin's edits apply on the very next message."""
    p = service.patient_profile(pid)
    if not p:
        return ""
    meds = ", ".join(f"{m['name']} {m['dose']} at {m['times']}" for m in service.medications(pid)) or "none listed"
    fac = f" Usual facility: {p['facility_name']} ({p['facility_kind']})." if p.get("facility_name") else ""
    return (
        f"\nPATIENT: {p['name']}, {p['age']}, {'woman' if p['sex'] == 'F' else 'man' if p['sex'] == 'M' else 'person'}. "
        f"Conditions: {p['conditions'] or 'none listed'}. Allergies: {p['allergies'] or 'none known'}.{fac} Medicines: {meds}."
        f"\nCARE INSTRUCTIONS (follow these): {p['instructions'] or 'none yet'}"
    )


LANGUAGES = {
    "en-IN": ("English", "English"), "hi-IN": ("Hindi", "हिन्दी"), "hi-Latn": ("Hinglish", "Hinglish"),
    "ta-IN": ("Tamil", "தமிழ்"), "te-IN": ("Telugu", "తెలుగు"), "bn-IN": ("Bengali", "বাংলা"), "kn-IN": ("Kannada", "ಕನ್ನಡ"),
}


def language_note(code: str, role: str) -> str:
    """Per-turn language instruction appended to the system prompt (so switching language mid-chat keeps context)."""
    if code not in LANGUAGES:
        code = "en-IN"
    name, native = LANGUAGES[code]
    if role == "family":
        return "\nReply to the caregiver in clear English."
    if code == "hi-Latn":
        return (
            "\nLANGUAGE: the person speaks Hinglish: Hindi written in the Roman (English) alphabet, mixed naturally with common "
            "English words, the way people text and talk in India (for example \"Aapne apni metformin li? Bahut accha!\"). Reply ONLY in "
            "Hinglish using Roman letters, never Devanagari. Keep it SHORT: at most three short sentences and at most one question, because "
            "this is read aloud. You are a woman: use feminine first-person forms (\"main dekh rahi hoon\"). Tool arguments stay in English. "
            "Write notes, memories and family alerts in plain English. Quote appointment times exactly from each appointment's `when` field."
        )
    if code == "en-IN":
        return "\nSpeak in simple Indian English, at most three short sentences. If the person writes in another language, reply in that language."
    return (
        f"\nLANGUAGE: the person speaks {name} ({native}). Reply ONLY in {name}, written in its native script, in simple "
        "spoken style that a text-to-speech voice can read naturally. Keep medicine names recognisable (you may write them in the "
        f"native script). Tool arguments (medication names, ISO dates, severities) must stay in English/Latin script. When you save "
        "notes, memories or family alerts, write them in English so the family dashboard stays readable, quoting the person's own "
        "meaning faithfully. If the person switches language, follow them. Still keep it SHORT: at most three short sentences "
        "and at most one question per reply, because this is read aloud. You are a woman: use feminine first-person verb forms "
        "where the language marks gender. Quote appointment times exactly from each appointment's `when` field; never work out weekdays yourself."
    )


# Fixed, human-reviewable emergency wording. When an URGENT alert is raised in the patient's own conversation, THIS is what is said, not model
# output: a language model must never be the one improvising an emergency script (it once promised "help is on the way" and wrote "she
# has called 112" into the alert). Numbers are digits so every text-to-speech voice reads them the same way.
SAFETY_MESSAGES = {
    "en-IN": "Please call 112 now. For an ambulance, call 108. I have told your family: {names}. I cannot call for help myself, so please call now.",
    "hi-IN": "कृपया अभी 112 पर कॉल करें। एम्बुलेंस के लिए 108 पर कॉल करें। मैंने आपके परिवार को बता दिया है: {names}। मैं खुद मदद नहीं बुला सकती, इसलिए आप अभी कॉल करें।",
    "hi-Latn": "Please abhi 112 par call kijiye. Ambulance ke liye 108 par call kijiye. Maine aapke parivaar ko bata diya hai: {names}. Main khud madad nahi bula sakti, isliye aap abhi call kijiye.",
    "ta-IN": "தயவுசெய்து இப்போதே 112 ஐ அழைக்கவும். ஆம்புலன்ஸுக்கு 108 ஐ அழைக்கவும். உங்கள் குடும்பத்தினருக்கு நான் தெரிவித்துவிட்டேன்: {names}. நான் உதவியை அழைக்க முடியாது, எனவே நீங்களே இப்போதே அழைக்கவும்.",
    "te-IN": "దయచేసి ఇప్పుడే 112 కు కాల్ చేయండి. అంబులెన్స్ కోసం 108 కు కాల్ చేయండి. మీ కుటుంబానికి నేను తెలియజేశాను: {names}. నేను సహాయం పిలవలేను, కాబట్టి మీరే ఇప్పుడే కాల్ చేయండి.",
    "bn-IN": "অনুগ্রহ করে এখনই 112 নম্বরে ফোন করুন। অ্যাম্বুলেন্সের জন্য 108 নম্বরে ফোন করুন। আমি আপনার পরিবারকে জানিয়েছি: {names}। আমি নিজে সাহায্য ডাকতে পারি না, তাই আপনি এখনই ফোন করুন।",
    "kn-IN": "ದಯವಿಟ್ಟು ಈಗಲೇ 112 ಗೆ ಕರೆ ಮಾಡಿ. ಆಂಬ್ಯುಲೆನ್ಸ್‌ಗಾಗಿ 108 ಗೆ ಕರೆ ಮಾಡಿ. ನಾನು ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸಿದ್ದೇನೆ: {names}. ನಾನು ಸ್ವತಃ ಸಹಾಯ ಕರೆಯಲು ಸಾಧ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ ನೀವೇ ಈಗಲೇ ಕರೆ ಮಾಡಿ.",
}


def safety_message(language: str, names: str) -> str:
    return SAFETY_MESSAGES.get(language, SAFETY_MESSAGES["en-IN"]).format(names=names or "your family")


def urgent_alert(result) -> dict | None:
    """The alert dict if this tool result is an URGENT raise_family_alert, else None."""
    a = (result or {}).get("alert") if isinstance(result, dict) else None
    return a if a and a.get("severity") == "urgent" else None


_lock = threading.Lock()
# One MCP connection per (signed-in user, patient). The connection carries THEIR token and the patient id, and the server
# checks both: a conversation about one patient can never read or write another patient's record.
_clients: dict[tuple[str, str], tuple[MCPClient, list]] = {}
_sessions: dict[str, Agent] = {}
_model: BedrockModel | None = None


def _ensure_runtime(actor: auth.Actor, pid: str) -> list:
    """Return the MCP tools this user may use for this patient. The server enforces RBAC too; filtering here keeps the model from trying."""
    global _model
    if not actor.can_access(pid):
        raise PermissionError("No access to that patient")
    with _lock:
        if (actor.id, pid) not in _clients:
            headers = {"Authorization": f"Bearer {auth.make_token(actor)}", "X-Patient-Id": pid}
            client = MCPClient(lambda: streamablehttp_client(MCP_URL, headers=headers))
            client.start()
            _clients[(actor.id, pid)] = (client, client.list_tools_sync())
        if _model is None:
            _model = BedrockModel(model_id=MODEL_ID, region_name=REGION, temperature=0.4, max_tokens=900)
        tools = _clients[(actor.id, pid)][1]
    return [t for t in tools if actor.can(auth.TOOL_PERMS.get(t.tool_name, "never"))]


def shutdown() -> None:
    with _lock:
        for client, _ in _clients.values():
            try:
                client.stop(None, None, None)
            except Exception:
                pass
        _clients.clear()


def drop_connections(user_id: str) -> None:
    """Close a user's MCP connections (called when their account is removed or demoted)."""
    with _lock:
        for k in [k for k in _clients if k[0] == user_id]:
            try:
                _clients.pop(k)[0].stop(None, None, None)
            except Exception:
                pass
    for key in [k for k in _sessions if k.startswith(f"{user_id}:")]:
        _sessions.pop(key, None)


def _agent(session_id: str, actor: auth.Actor, pid: str, role: str, language: str = "en-IN") -> Agent:
    # Sessions are keyed by user AND patient, so knowing someone else's session id (or switching patient) never reuses a conversation.
    key = f"{actor.id}:{pid}:{session_id}:{role}"
    if key not in _sessions:
        prompt = SYSTEM_PROMPT.format(today=datetime.now().strftime("%A %d %B %Y, %H:%M"))
        if role == "family":
            prompt += "\nYou are speaking with a FAMILY CAREGIVER or clinician, not the patient. Be concise, factual and organised. Plain text only: no markdown symbols, no emoji."
        tools = _ensure_runtime(actor, pid)     # must run first: it creates _model. (Passing both inline built the first agent with model=None.)
        _sessions[key] = Agent(model=_model, tools=tools, system_prompt=prompt, callback_handler=None)
        _sessions[key]._base_prompt = prompt  # type: ignore[attr-defined]
    agent = _sessions[key]
    agent.system_prompt = agent._base_prompt + patient_context(pid) + language_note(language, role)  # type: ignore[attr-defined]
    return agent


def _parse_result(tr: dict):
    data = None
    for part in tr.get("content", []):
        if "json" in part:
            data = part["json"]
        elif "text" in part:
            try:
                data = json.loads(part["text"])
            except Exception:
                data = {"text": part["text"]}
    return data


def _tool_events(agent: Agent, start: int) -> list[dict]:
    """Pull tool calls + results from this turn so the UI can render cards."""
    calls: dict[str, dict] = {}
    events: list[dict] = []
    for msg in agent.messages[start:]:
        for block in msg.get("content", []):
            if "toolUse" in block:
                tu = block["toolUse"]
                calls[tu["toolUseId"]] = {"tool": tu["name"], "input": tu.get("input", {})}
            elif "toolResult" in block:
                tr = block["toolResult"]
                data = _parse_result(tr)
                call = calls.get(tr["toolUseId"], {"tool": "unknown", "input": {}})
                events.append({**call, "status": tr.get("status", "success"), "result": data})
    return events


def role_for(actor: auth.Actor) -> str:
    """Which prompt/persona a signed-in user gets. Derived from the verified account, never from a client-supplied field."""
    return "person" if actor.role == "person" else "family"


def chat(actor: auth.Actor, pid: str, message: str, session_id: str | None = None, language: str = "en-IN") -> dict:
    session_id = session_id or uuid.uuid4().hex[:8]
    role = role_for(actor)
    agent = _agent(session_id, actor, pid, role, language)
    start = len(agent.messages)
    result = agent(message)
    events = _tool_events(agent, start)
    reply = str(result).strip()
    if role == "person":
        urgent = next((urgent_alert(e["result"]) for e in events if e["tool"] == "raise_family_alert" and urgent_alert(e["result"])), None)
        if urgent:
            reply = safety_message(language, urgent.get("notified", ""))
    return {"session_id": session_id, "reply": reply, "tool_events": events}


CARE_WATCH_PROMPT = """\
Run an autonomous CARE WATCH review now, as a background job with no one to talk to.
1) Call get_care_snapshot and analyze_wellbeing_trends (they include vital signs).
2) Decide whether the family needs to know. Alert ONLY for (a) multi-day patterns such as falling mood or sleep, rising
   pain, repeated missed doses, or several signals compounding, or (b) anything safety-related. Do NOT alert for same-day
   late doses (Alexa already nudges the person), a routine upcoming appointment, or a steady week. If you alert, raise at most
   TWO alerts (merge related concerns) with an honest severity (watch/high/urgent) and a calm, specific detail a relative can
   act on. If there is nothing to flag, raise nothing and say so.
3) If you do alert and a doctor's appointment is within 3 days that needs a ride, mention it in that alert.
4) Finish with a report for the family dashboard: plain text only, no markdown, no emoji, under 110 words, in three short
   paragraphs: what you checked, what you found, what you did. Stick to the data; do not invent timeframes or dramatise.
"""


def care_watch(actor: auth.Actor, pid: str) -> dict:
    return chat(actor, pid, CARE_WATCH_PROMPT, session_id=f"watch-{uuid.uuid4().hex[:6]}")


DIGEST_PROMPT = """\
Write this week's family digest for the caregivers. Use get_care_snapshot and analyze_wellbeing_trends.
Plain text only: no markdown symbols, no emoji. Structure: one headline line, then "What went well:", "What to watch:",
"Next steps:" (max 3, concrete) each on its own line. Under 150 words. Do not raise alerts. Do not invent data.
"""


def family_digest(actor: auth.Actor, pid: str) -> dict:
    return chat(actor, pid, DIGEST_PROMPT, session_id=f"digest-{uuid.uuid4().hex[:6]}")


async def stream(actor: auth.Actor, pid: str, message: str, session_id: str | None = None, language: str = "en-IN"):
    """Yield UI events: session, tool_start, tool_result, text, done | error."""
    session_id = session_id or uuid.uuid4().hex[:8]
    yield {"type": "session", "session_id": session_id}
    try:
        await asyncio.to_thread(_ensure_runtime, actor, pid)
        agent = _agent(session_id, actor, pid, role_for(actor), language)
        started: set[str] = set()
        inputs: dict[str, dict] = {}
        names: dict[str, str] = {}
        full: list[str] = []
        is_person = role_for(actor) == "person"
        overridden = False                         # an urgent alert was raised: the server speaks, the model is muted
        async for ev in agent.stream_async(message):
            if "data" in ev:
                if overridden:
                    continue
                full.append(ev["data"])
                yield {"type": "text", "delta": ev["data"]}
            elif "current_tool_use" in ev:
                tu = ev["current_tool_use"]
                tid = tu.get("toolUseId")
                if tid and tid not in started:
                    started.add(tid)
                    names[tid] = tu.get("name", "")
                    yield {"type": "tool_start", "id": tid, "tool": tu.get("name", "")}
            elif "message" in ev:
                for block in ev["message"].get("content", []):
                    if "toolUse" in block:
                        inputs[block["toolUse"]["toolUseId"]] = block["toolUse"].get("input", {})
                    elif "toolResult" in block:
                        tr = block["toolResult"]
                        tid = tr["toolUseId"]
                        parsed = _parse_result(tr)
                        yield {"type": "tool_result", "id": tid, "tool": names.get(tid, ""),
                               "input": inputs.get(tid, {}), "status": tr.get("status", "success"), "result": parsed}
                        if is_person and not overridden and names.get(tid) == "raise_family_alert" and (u := urgent_alert(parsed)):
                            overridden = True
                            text = safety_message(language, u.get("notified", ""))
                            full.append(("\n" if full else "") + text)
                            yield {"type": "text", "delta": text}
        yield {"type": "done", "reply": "".join(full).strip()}
    except Exception as e:  # noqa: BLE001 - the UI gets a neutral message; the details stay in the server log
        log.exception("agent stream failed: %s", type(e).__name__)
        yield {"type": "error", "message": "The assistant is unavailable right now. Please try again in a moment."}

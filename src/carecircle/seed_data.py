"""Synthetic households: 6 families, 10 patients with different conditions, family admins/members and clinicians.

Everything here is invented. Demo passwords follow one rule so judges can sign in: <FirstName>_2026
(clinicians use their surname, e.g. Sen_2026).
"""
from __future__ import annotations

import random
from datetime import timedelta

from . import db, passwords

SCENARIOS = ("decline", "stable", "fresh")


def M(name, dose, purpose, times, food=False, notes=None, prescriber=None):
    return dict(name=name, dose=dose, purpose=purpose, times=times, food=food, notes=notes, prescriber=prescriber)


def V(kind, base, unit, noise, drift=(0, 0), base2=None):
    return dict(kind=kind, base=base, base2=base2, unit=unit, noise=noise, drift=drift)


FAMILIES = [
    dict(id="deshmukh", name="Deshmukh family", city="Pune", notes="Parents live with son Rohan; daughter Meera visits on weekends."),
    dict(id="iyer", name="Iyer family", city="Chennai", notes="Mother lives with son Suresh and his wife Priya."),
    dict(id="khan", name="Khan family", city="Hyderabad", notes="Both parents live in the family home; children in the same city."),
    dict(id="gupta", name="Gupta family", city="New Delhi", notes="Grandmother lives with son Vikram's family; day-care on weekdays."),
    dict(id="nair", name="Nair family", city="Kochi", notes="Couple live alone; son Jacob works in Dubai, daughter Anu lives nearby."),
    dict(id="banerjee", name="Banerjee family", city="Kolkata", notes="Couple live with son Soumya's family."),
]

FACILITIES = [
    ("deshmukh", "Sen Clinic, Kothrud", "clinic", "14 Karve Road, Kothrud, Pune", "+91 20 2545 0101"),
    ("deshmukh", "Lakeview Hospital, Pune", "hospital", "Sangamwadi Road, Pune", "+91 20 2612 0202"),
    ("iyer", "Greams Kidney & Dialysis Centre", "hospital", "Greams Road, Chennai", "+91 44 2829 0303"),
    ("khan", "Banjara Chest & Allergy Clinic", "clinic", "Road No. 12, Banjara Hills, Hyderabad", "+91 40 2355 0404"),
    ("gupta", "Sunrise Memory Day Centre", "day care", "Sector 12, Dwarka, New Delhi", "+91 11 4506 0505"),
    ("gupta", "Dwarka Geriatric Clinic", "clinic", "Sector 6, Dwarka, New Delhi", "+91 11 2508 0606"),
    ("nair", "St. Thomas Neuro Centre", "hospital", "MG Road, Kochi", "+91 484 235 0707"),
    ("banerjee", "Salt Lake Heart Institute", "hospital", "Sector V, Salt Lake, Kolkata", "+91 33 2357 0808"),
]

# (id, family, name, age, sex, conditions, allergies, language, facility name, instructions, trend, ...)
PATIENTS = [
    dict(
        id="asha", family="deshmukh", name="Asha Deshmukh", age=78, sex="F", language="en-IN", facility="Sen Clinic, Kothrud", trend="decline",
        conditions="Type 2 diabetes, hypertension, osteoarthritis (knees)", allergies="Sulfa drugs",
        instructions="Check fasting sugar before breakfast and note it. Call Dr. Sen if sugar is above 250 or below 70. Avoid stairs when her knees are bad. Likes a gentle, unhurried morning chat.",
        meds=[M("Metformin", "500 mg", "Blood sugar", "08:00,20:00", True, "Take with food", "Dr. Sen"), M("Amlodipine", "5 mg", "Blood pressure", "08:00", False, "Same time each morning", "Dr. Sen"),
              M("Atorvastatin", "10 mg", "Cholesterol", "21:00", False, "Evening", "Dr. Sen"), M("Vitamin D3", "1000 IU", "Bone health", "08:00", True)],
        vitals=[V("glucose", 126, "mg/dL", (9, 0), (14, 0)), V("bp", 132, "mmHg", (6, 0), (3, 0), base2=82)],
        ci=dict(mood=4, pain=3, sleep=7.2, notes=["Went for a short walk, felt fine.", "Slept a bit lightly. Knees stiff in the morning.", "Skipped dinner because I felt tired.", "Did not feel like talking much. Woke up twice in the night."]),
        appts=[("Diabetes review", "Dr. Sen", 2, 10, "Sen Clinic, Kothrud", 1, "Bring glucose log; fasting blood test first"), ("Physiotherapy", "Priya (PT)", 5, 16, "Home visit", 0, "Knee mobility exercises"), ("Eye check-up", "Dr. Rao", 12, 11, "Rao Eye Centre", 1, None)],
        memories=[("preference", "Asha prefers to be called 'Asha tai'. She likes gentle, unhurried conversation in the morning."), ("preference", "Evening doses are easier to remember when linked to the 9 pm news bulletin."), ("context", "Granddaughter Isha visits on weekends; Asha is cheerful afterwards.")],
    ),
    dict(
        id="madhav", family="deshmukh", name="Madhav Deshmukh", age=81, sex="M", language="en-IN", facility="Lakeview Hospital, Pune", trend="stable",
        conditions="Ischaemic stroke (2024) with mild right-sided weakness, atrial fibrillation, benign prostatic hyperplasia", allergies="None known",
        instructions="On warfarin: INR target 2.0-3.0, checked monthly. No NSAIDs (ibuprofen, diclofenac). Report black stools, nosebleeds or unusual bruising the same day. Needs an arm on the stairs. Physiotherapy exercises daily after breakfast.",
        meds=[M("Warfarin", "3 mg", "Stroke prevention (AF)", "18:00", False, "Same time daily. Dose changes only by Dr. Sen after an INR test", "Dr. Sen"), M("Metoprolol", "25 mg", "Heart rate control", "08:00,20:00", True, None, "Dr. Sen"),
              M("Atorvastatin", "20 mg", "Cholesterol", "21:00", False, None, "Dr. Sen"), M("Tamsulosin", "0.4 mg", "Prostate / urine flow", "21:00", False, "After dinner; stand up slowly", "Dr. Sen")],
        vitals=[V("bp", 128, "mmHg", (6, 0), (0, 0), base2=78), V("hr", 72, "bpm", (5, 0)), V("inr", 2.5, "", (0.25, 0))],
        ci=dict(mood=3, pain=2, sleep=6.5, notes=["Did the exercises, a little tired.", "Right hand felt weaker this morning.", "Slept badly, up twice for the toilet.", "Low mood, did not want to do exercises."]),
        miss_p=0.04,
        appts=[("INR blood test", "Lab", 3, 9, "Lakeview Hospital, Pune", 1, "Fasting not needed"), ("Neurology follow-up", "Dr. Kulkarni", 18, 12, "Lakeview Hospital, Pune", 1, "Bring BP and INR log")],
        memories=[("preference", "Madhav likes cricket commentary on the radio while exercising."), ("context", "Right hand is weaker in the mornings; button shirts are hard for him.")],
    ),
    dict(
        id="lakshmi", family="iyer", name="Lakshmi Iyer", age=74, sex="F", language="en-IN", facility="Greams Kidney & Dialysis Centre", trend="decline",
        conditions="Chronic kidney disease stage 3b, hypertension, anaemia of CKD", allergies="Penicillin",
        instructions="Fluid limit 1.5 litres a day. Low-potassium, low-salt diet. Avoid painkillers like diclofenac or ibuprofen. Weigh every morning and note swelling in the feet. Call the nephrologist if weight rises more than 2 kg in 3 days.",
        meds=[M("Telmisartan", "40 mg", "Blood pressure / kidney protection", "08:00", False, None, "Dr. Raman"), M("Amlodipine", "5 mg", "Blood pressure", "08:00", False, None, "Dr. Raman"),
              M("Calcium acetate", "667 mg", "Phosphate binder", "08:00,13:00,20:00", True, "Take with the first bite of the meal", "Dr. Raman"), M("Ferrous ascorbate", "100 mg", "Anaemia", "15:00", False, "Not with tea or coffee", "Dr. Raman")],
        vitals=[V("bp", 138, "mmHg", (6, 0), (5, 0), base2=84), V("weight", 58.2, "kg", (0.25, 0), (0.7, 0))],
        ci=dict(mood=4, pain=2, sleep=6.8, notes=["Good day. Walked to the temple.", "Ankles slightly puffy by evening.", "Tired and short of breath on the stairs.", "Swelling worse, no appetite, felt nauseous."]),
        appts=[("Nephrology review + labs", "Dr. Raman", 4, 11, "Greams Kidney & Dialysis Centre", 1, "Creatinine, potassium, haemoglobin"), ("Dietitian", "Ms. Janani", 10, 15, "Greams Kidney & Dialysis Centre", 0, "Bring 3-day food diary")],
        memories=[("preference", "Lakshmi prefers to be addressed as 'Amma' and likes Carnatic music in the evening."), ("context", "Suresh brings her to clinic visits; auto-rickshaw is hard on her back.")],
    ),
    dict(
        id="abdul", family="khan", name="Abdul Khan", age=69, sex="M", language="en-IN", facility="Banjara Chest & Allergy Clinic", trend="decline",
        conditions="COPD (GOLD 3), ex-smoker (30 pack-years), mild hypertension", allergies="Aspirin (wheeze)",
        instructions="Home oxygen 2 L/min at night. Keep oxygen saturation at or above 90%. Rinse mouth after the steroid inhaler. Use the spacer. If saturation is below 88% or he cannot speak full sentences, call the doctor or go to the hospital. Avoid dust and incense smoke.",
        meds=[M("Tiotropium inhaler", "18 mcg", "COPD maintenance", "08:00", False, "One capsule via HandiHaler", "Dr. Reddy"), M("Budesonide/Formoterol inhaler", "160/4.5 mcg", "COPD maintenance", "08:00,20:00", False, "2 puffs; rinse mouth after", "Dr. Reddy"),
              M("Montelukast", "10 mg", "Airway inflammation", "21:00", False, None, "Dr. Reddy"), M("Amlodipine", "5 mg", "Blood pressure", "08:00", False, None, "Dr. Reddy")],
        vitals=[V("spo2", 94, "%", (0.8, 0), (-1.3, 0)), V("hr", 80, "bpm", (5, 0), (4, 0)), V("bp", 136, "mmHg", (6, 0), (2, 0), base2=84)],
        ci=dict(mood=4, pain=1, sleep=6.8, notes=["Breathing fine, walked to the mosque.", "A bit more breathless on the stairs.", "Cough with more phlegm, woke up breathless once.", "Very breathless, could not finish sentences this morning."]),
        appts=[("Pulmonology review + spirometry", "Dr. Reddy", 3, 10, "Banjara Chest & Allergy Clinic", 1, "Bring inhalers and oxygen log"), ("Flu vaccination", "Clinic nurse", 9, 12, "Banjara Chest & Allergy Clinic", 0, None)],
        memories=[("preference", "Abdul likes to be called 'Abba' by the family and prefers Urdu news in the morning."), ("context", "Winter and agarbatti smoke trigger his breathlessness.")],
    ),
    dict(
        id="zainab", family="khan", name="Zainab Khan", age=66, sex="F", language="en-IN", facility="Banjara Chest & Allergy Clinic", trend="stable",
        conditions="Hypothyroidism, osteoporosis, mild anxiety", allergies="None known",
        instructions="Levothyroxine on an empty stomach, 30-45 minutes before tea or breakfast. Calcium at least 4 hours apart from levothyroxine. Daily 20-minute walk in the garden. Report new back pain or any fall.",
        meds=[M("Levothyroxine", "75 mcg", "Thyroid", "06:30", False, "Empty stomach, water only", "Dr. Reddy"), M("Calcium + Vitamin D3", "500 mg / 250 IU", "Bone density", "13:00,21:00", True, "Not within 4 hours of levothyroxine", "Dr. Reddy"),
              M("Escitalopram", "5 mg", "Anxiety", "21:00", False, None, "Dr. Reddy")],
        vitals=[V("weight", 61.5, "kg", (0.3, 0)), V("bp", 122, "mmHg", (5, 0), base2=76)],
        ci=dict(mood=4, pain=2, sleep=7.0, notes=["Did my walk, felt calm.", "A little worried about the thyroid test.", "Slept lightly.", "Anxious and tearful."]),
        miss_p=0.04,
        appts=[("Thyroid profile (TSH)", "Lab", 6, 8, "Banjara Chest & Allergy Clinic", 0, "Before taking levothyroxine"), ("DEXA scan", "Radiology", 21, 10, "Banjara Chest & Allergy Clinic", 1, None)],
        memories=[("preference", "Zainab enjoys gardening; talk about her roses to lift her mood.")],
    ),
    dict(
        id="kamla", family="gupta", name="Kamla Gupta", age=85, sex="F", language="hi-IN", facility="Sunrise Memory Day Centre", trend="decline",
        conditions="Alzheimer's disease (moderate), hypertension, previous hip fracture (fall risk)", allergies="None known",
        instructions="Never leave her alone near stairs or the kitchen. Sundowning between 5 and 8 pm: keep lights on, play bhajans, avoid arguments. Caregiver gives medicines personally and stays until swallowed; tablets are kept locked. Day centre Monday to Friday, 10 am to 4 pm. Report night wandering immediately.",
        meds=[M("Donepezil", "5 mg", "Alzheimer's", "21:00", False, "May cause vivid dreams", "Dr. Mehta"), M("Memantine", "10 mg", "Alzheimer's", "08:00,20:00", False, None, "Dr. Mehta"),
              M("Amlodipine", "2.5 mg", "Blood pressure", "08:00", False, None, "Dr. Mehta"), M("Calcium + Vitamin D3", "500 mg / 250 IU", "Bone health", "14:00", True, None, "Dr. Mehta")],
        vitals=[V("bp", 130, "mmHg", (6, 0), (3, 0), base2=80), V("weight", 49.5, "kg", (0.3, 0), (-0.3, 0))],
        ci=dict(mood=3, pain=1, sleep=6.0, notes=["Calm day, enjoyed bhajans at the centre.", "Restless in the evening, asked for her mother.", "Refused dinner and medicines, agitated at sunset.", "Got up at 2 am and tried to leave the house."]),
        miss_p=0.07,
        appts=[("Geriatric review", "Dr. Mehta", 5, 11, "Dwarka Geriatric Clinic", 1, "Bring sleep and wandering notes"), ("Hearing test", "Audiologist", 14, 15, "Dwarka Geriatric Clinic", 1, None)],
        memories=[("preference", "Kamla calms down with old Hindi film songs; Rafi and Lata work best."), ("context", "She sometimes mistakes Neha for her late sister. Do not correct her sharply.")],
    ),
    dict(
        id="thomas", family="nair", name="Thomas Nair", age=72, sex="M", language="en-IN", facility="St. Thomas Neuro Centre", trend="decline",
        conditions="Parkinson's disease (Hoehn & Yahr 2.5), depression", allergies="None known",
        instructions="Levodopa timing is strict: 06:30, 10:30, 14:30 and 18:30, 30 minutes before food. Avoid heavy protein meals near doses. Report falls, hallucinations, or freezing episodes the same day. A late dose causes stiffness and slowness within an hour.",
        meds=[M("Levodopa/Carbidopa", "100/25 mg", "Parkinson's", "06:30,10:30,14:30,18:30", False, "30 minutes before food", "Dr. Varghese"), M("Pramipexole", "0.5 mg", "Parkinson's", "08:00,20:00", False, None, "Dr. Varghese"),
              M("Rasagiline", "1 mg", "Parkinson's", "08:00", False, None, "Dr. Varghese"), M("Sertraline", "50 mg", "Depression", "08:00", True, None, "Dr. Varghese")],
        vitals=[V("bp", 118, "mmHg", (6, 0), (-3, 0), base2=72), V("weight", 66.0, "kg", (0.3, 0), (-0.2, 0))],
        ci=dict(mood=3, pain=3, sleep=6.0, notes=["Steady day, walked 15 minutes.", "Stiff before the afternoon dose.", "Two freezing episodes at the door, nearly fell.", "Very slow and stiff since noon, low mood, stopped eating."]),
        miss_p=0.04,
        appts=[("Neurology review", "Dr. Varghese", 7, 10, "St. Thomas Neuro Centre", 1, "Bring dose timing diary"), ("Physiotherapy (gait)", "Physio team", 2, 16, "St. Thomas Neuro Centre", 1, "LSVT BIG exercises")],
        memories=[("preference", "Thomas was a school teacher; he likes to be asked about his old students."), ("context", "Mariamma helps with every dose; if she is out, Anu comes over.")],
    ),
    dict(
        id="mariamma", family="nair", name="Mariamma Nair", age=70, sex="F", language="en-IN", facility="St. Thomas Neuro Centre", trend="stable",
        conditions="Osteoarthritis (both knees), hypertension; primary caregiver for her husband", allergies="Diclofenac (rash)",
        instructions="Watch for caregiver fatigue: encourage her to rest and to accept help from Anu. Knee exercises twice a day. Avoid diclofenac. Check BP weekly.",
        meds=[M("Losartan", "50 mg", "Blood pressure", "08:00", False, None, "Dr. Joseph"), M("Paracetamol", "650 mg", "Knee pain", "08:00,20:00", True, "Max 4 doses a day", "Dr. Joseph"), M("Calcium + Vitamin D3", "500 mg / 250 IU", "Bone health", "13:00", True)],
        vitals=[V("bp", 134, "mmHg", (6, 0), base2=82)],
        ci=dict(mood=3, pain=4, sleep=6.0, notes=["Managed the day well.", "Knees ache after helping Thomas.", "Very tired, did not sleep.", "Exhausted and tearful."]),
        miss_p=0.05,
        appts=[("Orthopaedic review", "Dr. Joseph", 11, 17, "St. Thomas Neuro Centre", 0, "Knee X-ray report")],
        memories=[("preference", "Mariamma puts everyone first; remind her gently to look after herself.")],
    ),
    dict(
        id="sudipta", family="banerjee", name="Sudipta Banerjee", age=67, sex="F", language="en-IN", facility="Salt Lake Heart Institute", trend="decline",
        conditions="Heart failure with reduced ejection fraction (EF 35%), previous heart attack (2025), hypertension", allergies="ACE inhibitors (cough)",
        instructions="Weigh every morning after passing urine, before breakfast. Call the cardiologist if weight rises more than 2 kg in 3 days or if breathlessness or ankle swelling increases. Fluid limit 1.5 litres. Low-salt diet: no pickles or papad. Do not stop any tablet without asking Dr. Das.",
        meds=[M("Carvedilol", "6.25 mg", "Heart failure", "08:00,20:00", True, None, "Dr. Das"), M("Sacubitril/Valsartan", "24/26 mg", "Heart failure", "08:00,20:00", False, None, "Dr. Das"),
              M("Furosemide", "40 mg", "Fluid control", "08:00", False, "Take early so she is not up at night", "Dr. Das"), M("Spironolactone", "25 mg", "Heart failure", "08:00", False, None, "Dr. Das"),
              M("Aspirin", "75 mg", "Heart protection", "14:00", True, None, "Dr. Das"), M("Atorvastatin", "40 mg", "Cholesterol", "21:00", False, None, "Dr. Das")],
        vitals=[V("weight", 62.0, "kg", (0.25, 0), (0.7, 0)), V("bp", 112, "mmHg", (5, 0), (-3, 0), base2=70), V("spo2", 96, "%", (0.6, 0), (-0.7, 0)), V("hr", 70, "bpm", (4, 0), (3, 0))],
        ci=dict(mood=4, pain=1, sleep=7.0, notes=["Felt strong, did the morning walk.", "Needed an extra pillow last night.", "Ankles swollen and breathless on the stairs.", "Woke up breathless, sleeping upright in the chair."]),
        appts=[("Heart failure clinic", "Dr. Das", 3, 11, "Salt Lake Heart Institute", 1, "Bring weight log; labs: potassium, creatinine"), ("Echocardiogram", "Cardiac lab", 20, 9, "Salt Lake Heart Institute", 1, None)],
        memories=[("preference", "Sudipta likes Rabindrasangeet in the evenings and is proud of her kitchen garden."), ("context", "Soumya reminds her about salt; she misses her pickle.")],
    ),
    dict(
        id="arun", family="banerjee", name="Arun Banerjee", age=70, sex="M", language="en-IN", facility="Salt Lake Heart Institute", trend="stable",
        conditions="Type 2 diabetes on insulin, early diabetic retinopathy", allergies="None known",
        instructions="Check fasting sugar and bedtime sugar. If sugar is below 70: 15 g fast sugar (3 glucose tablets or half a glass of juice), recheck in 15 minutes, and tell the family. Never skip meals after insulin. Annual eye exam due. Rotate injection sites.",
        meds=[M("Insulin glargine", "18 units", "Diabetes (basal)", "22:00", False, "Subcutaneous, rotate sites", "Dr. Das"), M("Metformin", "1000 mg", "Diabetes", "08:00,20:00", True, None, "Dr. Das"), M("Empagliflozin", "10 mg", "Diabetes", "08:00", False, "Stay well hydrated", "Dr. Das")],
        vitals=[V("glucose", 132, "mg/dL", (14, 0)), V("bp", 130, "mmHg", (6, 0), base2=80)],
        events=[(2, "glucose", 62, None, "mg/dL", 3)],      # a night-time low two days ago
        ci=dict(mood=4, pain=1, sleep=6.8, notes=["Good day, played carrom with the grandchildren.", "Woke at 3 am sweaty and shaky; had juice.", "Slept well.", "Tired after the night low."]),
        miss_p=0.04,
        appts=[("Diabetes & eye screening", "Dr. Das", 8, 10, "Salt Lake Heart Institute", 1, "Fundus exam; HbA1c"), ("Podiatry check", "Foot clinic", 16, 15, "Salt Lake Heart Institute", 0, None)],
        memories=[("preference", "Arun is a retired bank manager; he likes the sports page read to him.")],
    ),
]

# username, name, role, family, patient (for role person), phone, notify, blurb
USERS = [
    ("asha", "Asha Deshmukh", "person", "deshmukh", "asha", None, "urgent", "The person in care, using Alexa+ at home"),
    ("madhav", "Madhav Deshmukh", "person", "deshmukh", "madhav", None, "urgent", "Asha's husband, also in care"),
    ("rohan", "Rohan Deshmukh", "admin", "deshmukh", None, "+91 98220 10101", "all", "Son. Family admin, receives all updates"),
    ("meera", "Meera Kulkarni", "family", "deshmukh", None, "+91 98220 20202", "all", "Daughter. Family member"),
    ("isha", "Isha Kulkarni", "family", "deshmukh", None, "+91 98220 30303", "urgent", "Granddaughter (19). Family member"),
    ("lakshmi", "Lakshmi Iyer", "person", "iyer", "lakshmi", None, "urgent", "The person in care"),
    ("suresh", "Suresh Iyer", "admin", "iyer", None, "+91 98400 11111", "all", "Son. Family admin"),
    ("priya", "Priya Iyer", "family", "iyer", None, "+91 98400 22222", "urgent", "Daughter-in-law. Family member"),
    ("abdul", "Abdul Khan", "person", "khan", "abdul", None, "urgent", "The person in care"),
    ("zainab", "Zainab Khan", "person", "khan", "zainab", None, "urgent", "Abdul's wife, also in care"),
    ("imran", "Imran Khan", "admin", "khan", None, "+91 99890 12121", "all", "Son. Family admin"),
    ("sana", "Sana Khan", "family", "khan", None, "+91 99890 23232", "urgent", "Daughter. Family member"),
    ("vikram", "Vikram Gupta", "admin", "gupta", None, "+91 98110 13131", "all", "Son. Family admin (Kamla has no device of her own)"),
    ("neha", "Neha Gupta", "family", "gupta", None, "+91 98110 24242", "all", "Daughter-in-law. Main day-to-day caregiver"),
    ("thomas", "Thomas Nair", "person", "nair", "thomas", None, "urgent", "The person in care"),
    ("mariamma", "Mariamma Nair", "person", "nair", "mariamma", None, "urgent", "Thomas's wife, also in care and his main caregiver"),
    ("jacob", "Jacob Nair", "admin", "nair", None, "+971 50 123 4545", "all", "Son in Dubai. Family admin"),
    ("anu", "Anu Nair", "family", "nair", None, "+91 98470 25252", "all", "Daughter, lives nearby. Family member"),
    ("sudipta", "Sudipta Banerjee", "person", "banerjee", "sudipta", None, "urgent", "The person in care"),
    ("arun", "Arun Banerjee", "person", "banerjee", "arun", None, "urgent", "Sudipta's husband, also in care"),
    ("soumya", "Soumya Banerjee", "admin", "banerjee", None, "+91 98300 14141", "all", "Son. Family admin"),
    ("tania", "Tania Banerjee", "family", "banerjee", None, "+91 98300 26262", "urgent", "Daughter-in-law. Family member"),
]
CLINICIANS = [
    ("drsen", "Dr. Sen", "GP, Kothrud (Pune)", ["asha", "madhav"]),
    ("drmehta", "Dr. Mehta", "Geriatrician, Dwarka (Delhi)", ["kamla", "asha"]),
    ("drraman", "Dr. Raman", "Nephrologist, Chennai", ["lakshmi"]),
    ("drreddy", "Dr. Reddy", "Pulmonologist, Hyderabad", ["abdul", "zainab"]),
    ("drvarghese", "Dr. Varghese", "Neurologist, Kochi", ["thomas"]),
    ("drjoseph", "Dr. Joseph", "Orthopaedic surgeon, Kochi", ["mariamma"]),
    ("drdas", "Dr. Das", "Cardiologist, Kolkata", ["sudipta", "arun"]),
]


def demo_password(name: str) -> str:
    """<FirstName>_2026, skipping the title for doctors (Dr. Sen -> Sen_2026)."""
    parts = [p for p in name.replace(".", " ").split() if p.lower() != "dr"]
    return f"{parts[0]}_2026"


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _populate(c, p: dict, scenario: str) -> None:
    """Insert one patient's medicines, appointments, memories and (unless 'fresh') a week of history."""
    rnd = random.Random(f"carecircle-{p['id']}")
    today = db.now().replace(hour=0, minute=0, second=0)
    pid = p["id"]
    started = (today - timedelta(days=200)).date().isoformat()
    primary_doc = next((name for _, name, _, pats in CLINICIANS if pid in pats), "Family doctor")
    for m in p["meds"]:
        c.execute("INSERT INTO medications (patient_id,name,dose,purpose,times,with_food,notes,prescriber,started_at) VALUES (?,?,?,?,?,?,?,?,?)",
                  (pid, m["name"], m["dose"], m["purpose"], m["times"], int(m["food"]), m["notes"], m["prescriber"] or primary_doc, started))
    fac = c.execute("SELECT id FROM facilities WHERE family_id=? AND name=?", (p["family"], p["facility"])).fetchone()
    for title, doctor, days, hour, place, ride, notes in p["appts"]:
        when = (today + timedelta(days=days)).replace(hour=hour, minute=0)
        use_fac = c.execute("SELECT id FROM facilities WHERE family_id=? AND name=?", (p["family"], place)).fetchone()
        c.execute("INSERT INTO appointments (patient_id,title,doctor,starts_at,facility_id,location,needs_ride,notes) VALUES (?,?,?,?,?,?,?,?)",
                  (pid, title, doctor, when.isoformat(), (use_fac or fac)["id"] if (use_fac or fac) else None, place, ride, notes))
    for kind, text in p["memories"]:
        c.execute("INSERT INTO memories (patient_id,ts,kind,content) VALUES (?,?,?,?)", (pid, db.real_now().isoformat(), kind, text))
    if scenario == "fresh":
        return

    trend = "stable" if scenario == "stable" else p["trend"]
    meds = c.execute("SELECT id, times FROM medications WHERE patient_id=?", (pid,)).fetchall()
    ci = p["ci"]
    for d in range(7, 0, -1):
        day = (today - timedelta(days=d)).date().isoformat()
        decline = max(0, 4 - d) if trend == "decline" else 0        # 0 for older days, growing toward yesterday
        for m in meds:
            for slot in m["times"].split(","):
                miss = p.get("miss_p", 0.03) + 0.2 * decline
                missed = rnd.random() < miss and (slot >= "13:00" or decline >= 2)
                h, mi = map(int, slot.split(":"))
                c.execute("INSERT INTO dose_log (med_id,day,slot,status,logged_at) VALUES (?,?,?,?,?)",
                          (m["id"], day, slot, "missed" if missed else "taken", f"{day}T{h:02d}:{min(59, mi + rnd.randint(0, 20)):02d}:00"))
        mood = _clamp(ci["mood"] - decline + rnd.choice([0, 0, 1]) - (1 if decline >= 2 else 0), 1, 5)
        pain = _clamp(ci["pain"] + decline + rnd.choice([0, 1]), 0, 10)
        sleep = round(ci["sleep"] - 0.8 * decline + rnd.uniform(-0.4, 0.4), 1)
        c.execute("INSERT INTO checkins (patient_id,ts,mood,pain,sleep_hours,note) VALUES (?,?,?,?,?,?)",
                  (pid, f"{day}T09:15:00", mood, pain, sleep, ci["notes"][min(decline, 3)]))
        for v in p["vitals"]:
            step = decline * 1.0
            val = v["base"] + v["drift"][0] * step + rnd.uniform(-v["noise"][0], v["noise"][0])
            val2 = None
            if v["base2"] is not None:
                val2 = v["base2"] + v["drift"][0] * step * 0.5 + rnd.uniform(-4, 4)
            c.execute("INSERT INTO vitals (patient_id,ts,kind,value,value2,unit) VALUES (?,?,?,?,?,?)",
                      (pid, f"{day}T08:30:00", v["kind"], round(val, 1 if v["kind"] in ("weight", "inr") else 0), None if val2 is None else round(val2), v["unit"]))
    for days_ago, kind, value, value2, unit, hour in p.get("events", []):
        day = (today - timedelta(days=days_ago)).date().isoformat()
        c.execute("INSERT INTO vitals (patient_id,ts,kind,value,value2,unit) VALUES (?,?,?,?,?,?)", (pid, f"{day}T{hour:02d}:10:00", kind, value, value2, unit))


def _insert_user(c, username, name, role, family, patient, phone, notify, blurb) -> None:
    c.execute("INSERT OR IGNORE INTO users (id,name,role,family_id,patient_id,password_hash,phone,notify_level,blurb,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              (username, name, role, family, patient, passwords.hash_password(demo_password(name)), phone, notify, blurb, db.real_now().isoformat()))


def _insert_patient(c, p: dict) -> None:
    fac = c.execute("SELECT id FROM facilities WHERE family_id=? AND name=?", (p["family"], p["facility"])).fetchone()
    c.execute("INSERT OR REPLACE INTO patients (id,family_id,name,age,sex,conditions,allergies,language,facility_id,instructions) VALUES (?,?,?,?,?,?,?,?,?,?)",
              (p["id"], p["family"], p["name"], p["age"], p["sex"], p["conditions"], p["allergies"], p["language"], fac["id"] if fac else None, p["instructions"]))


def seed_all() -> None:
    with db.conn() as c:
        for f in FAMILIES:
            c.execute("INSERT OR IGNORE INTO families (id,name,city,notes) VALUES (?,?,?,?)", (f["id"], f["name"], f["city"], f["notes"]))
        for fam, name, kind, addr, phone in FACILITIES:
            if not c.execute("SELECT 1 FROM facilities WHERE family_id=? AND name=?", (fam, name)).fetchone():
                c.execute("INSERT INTO facilities (family_id,name,kind,address,phone) VALUES (?,?,?,?,?)", (fam, name, kind, addr, phone))
        for p in PATIENTS:
            _insert_patient(c, p)
        for u in USERS:
            _insert_user(c, *u)
        for username, name, blurb, patients in CLINICIANS:
            _insert_user(c, username, name, "clinician", None, None, None, "urgent", blurb)
            for pid in patients:
                c.execute("INSERT OR IGNORE INTO clinician_patients (user_id,patient_id) VALUES (?,?)", (username, pid))
        for p in PATIENTS:
            _populate(c, p, "decline")


def reseed(scenario: str, family_id: str | None = None) -> None:
    """Regenerate demo care data (for one family or all). Admin-created members/patients and all passwords/audit/chats survive."""
    with db.conn() as c:
        for p in PATIENTS:
            if family_id and p["family"] != family_id:
                continue
            pid = p["id"]
            c.execute("DELETE FROM dose_log WHERE med_id IN (SELECT id FROM medications WHERE patient_id=?)", (pid,))
            for t in ("medications", "checkins", "vitals", "appointments", "alerts", "memories"):
                c.execute(f"DELETE FROM {t} WHERE patient_id=?", (pid,))
            _insert_patient(c, p)
            _populate(c, p, scenario)

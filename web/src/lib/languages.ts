export interface LangStrings {
  morning: string; afternoon: string; evening: string
  idle: string; listening: string; thinking: string; speaking: string
  helpTitle: string; helpSub: string; placeholder: string
  honorific: string          // appended to the first name, e.g. "ताई"
  suggestions: [string, string, string, string, string, string]
}
export interface Language {
  code: string; name: string; native: string; strings: LangStrings; nameInScript: Record<string, string>
  recog: string        // speech-recognition locale
  speech: string       // locale used to pick the voice (Hinglish is Roman script, so it is spoken with an Indian-English voice)
  alexaPlus: boolean   // true if real Alexa+ supports it today (India launch: English, Hindi, Hinglish)
}

const EN: LangStrings = {
  morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening',
  idle: 'Ask me anything', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…',
  helpTitle: 'How can I help,', helpSub: "Tell me about your medicines, sleep or day, and I'll keep your family in the loop.",
  placeholder: 'Say or type something to Alexa…', honorific: 'ji',
  suggestions: ['Good morning', 'I took my {med}', 'I slept badly last night', "What's on today?", "I'm not feeling well today", 'Tell my family I need a ride on Friday'],
}

export const LANGUAGES: Language[] = [
  { code: 'en-IN', name: 'English', native: 'English', strings: EN, nameInScript: { Asha: 'Asha' }, recog: 'en-IN', speech: 'en-IN', alexaPlus: true },
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी', nameInScript: { Asha: 'आशा' }, recog: 'hi-IN', speech: 'hi-IN', alexaPlus: true, strings: {
    morning: 'सुप्रभात', afternoon: 'नमस्कार', evening: 'शुभ संध्या',
    idle: 'कुछ भी पूछिए', listening: 'सुन रही हूँ…', thinking: 'सोच रही हूँ…', speaking: 'बोल रही हूँ…',
    helpTitle: 'मैं कैसे मदद करूँ,', helpSub: 'अपनी दवाइयों, नींद या दिन के बारे में बताइए। मैं आपके परिवार को खबर देती रहूँगी।',
    placeholder: 'अलेक्सा से कुछ कहें या लिखें…', honorific: 'जी',
    suggestions: ['सुप्रभात', 'मैंने अपनी {med} ले ली', 'कल रात मुझे ठीक से नींद नहीं आई', 'आज क्या-क्या है?', 'आज मेरी तबीयत ठीक नहीं है', 'परिवार को बताओ कि मुझे शुक्रवार को गाड़ी चाहिए'] } },
  { code: 'hi-Latn', name: 'Hinglish', native: 'Hinglish', nameInScript: { Asha: 'Asha' }, recog: 'hi-IN', speech: 'en-IN', alexaPlus: true, strings: {
    morning: 'Suprabhat', afternoon: 'Namaste', evening: 'Shubh sandhya',
    idle: 'Kuch bhi poochiye', listening: 'Sun rahi hoon…', thinking: 'Soch rahi hoon…', speaking: 'Bol rahi hoon…',
    helpTitle: 'Main kaise madad karoon,', helpSub: 'Apni dawaiyon, neend ya din ke baare mein bataiye. Main aapke parivaar ko khabar deti rahungi.',
    placeholder: 'Alexa se kuch kahiye ya likhiye…', honorific: 'ji',
    suggestions: ['Suprabhat', 'Maine apni {med} le li', 'Kal raat mujhe theek se neend nahi aayi', 'Aaj kya-kya hai?', 'Aaj meri tabiyat theek nahi hai', 'Parivaar ko batao ki mujhe Friday ko gaadi chahiye'] } },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்', recog: 'ta-IN', speech: 'ta-IN', alexaPlus: false, nameInScript: { Asha: 'ஆஷா' }, strings: {
    morning: 'காலை வணக்கம்', afternoon: 'மதிய வணக்கம்', evening: 'மாலை வணக்கம்',
    idle: 'எதுவும் கேளுங்கள்', listening: 'கேட்கிறேன்…', thinking: 'யோசிக்கிறேன்…', speaking: 'பேசுகிறேன்…',
    helpTitle: 'நான் எப்படி உதவலாம்,', helpSub: 'உங்கள் மருந்துகள், தூக்கம் அல்லது நாள் பற்றி சொல்லுங்கள். உங்கள் குடும்பத்திற்கு நான் தெரிவிப்பேன்.',
    placeholder: 'அலெக்ஸாவிடம் பேசுங்கள் அல்லது தட்டச்சு செய்யுங்கள்…', honorific: 'அவர்களே',
    suggestions: ['காலை வணக்கம்', 'நான் {med} மாத்திரை சாப்பிட்டேன்', 'நேற்று இரவு எனக்கு சரியாக தூக்கம் வரவில்லை', 'இன்று என்ன இருக்கிறது?', 'இன்று எனக்கு உடம்பு சரியில்லை', 'வெள்ளிக்கிழமை எனக்கு வாகனம் வேண்டும் என்று குடும்பத்தினரிடம் சொல்லுங்கள்'] } },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు', recog: 'te-IN', speech: 'te-IN', alexaPlus: false, nameInScript: { Asha: 'ఆశా' }, strings: {
    morning: 'శుభోదయం', afternoon: 'శుభ మధ్యాహ్నం', evening: 'శుభ సాయంత్రం',
    idle: 'ఏదైనా అడగండి', listening: 'వింటున్నాను…', thinking: 'ఆలోచిస్తున్నాను…', speaking: 'మాట్లాడుతున్నాను…',
    helpTitle: 'నేను ఎలా సహాయం చేయగలను,', helpSub: 'మీ మందులు, నిద్ర లేదా రోజు గురించి చెప్పండి. మీ కుటుంబానికి నేను తెలియజేస్తాను.',
    placeholder: 'అలెక్సాతో మాట్లాడండి లేదా టైప్ చేయండి…', honorific: 'గారు',
    suggestions: ['శుభోదయం', 'నేను నా {med} మాత్ర వేసుకున్నాను', 'నిన్న రాత్రి నాకు సరిగా నిద్ర పట్టలేదు', 'ఈ రోజు ఏమి ఉంది?', 'ఈ రోజు నాకు ఆరోగ్యం బాగాలేదు', 'శుక్రవారం నాకు వాహనం కావాలని కుటుంబానికి చెప్పు'] } },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা', recog: 'bn-IN', speech: 'bn-IN', alexaPlus: false, nameInScript: { Asha: 'আশা' }, strings: {
    morning: 'সুপ্রভাত', afternoon: 'শুভ অপরাহ্ন', evening: 'শুভ সন্ধ্যা',
    idle: 'যা খুশি জিজ্ঞাসা করুন', listening: 'শুনছি…', thinking: 'ভাবছি…', speaking: 'বলছি…',
    helpTitle: 'আমি কীভাবে সাহায্য করব,', helpSub: 'আপনার ওষুধ, ঘুম বা দিনের কথা বলুন। আমি আপনার পরিবারকে জানিয়ে রাখব।',
    placeholder: 'অ্যালেক্সাকে কিছু বলুন বা লিখুন…', honorific: 'জি',
    suggestions: ['সুপ্রভাত', 'আমি আমার {med} খেয়েছি', 'কাল রাতে আমার ভালো ঘুম হয়নি', 'আজ কী কী আছে?', 'আজ আমার শরীর ভালো নেই', 'পরিবারকে বলো আমার শুক্রবার গাড়ি লাগবে'] } },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', recog: 'kn-IN', speech: 'kn-IN', alexaPlus: false, nameInScript: { Asha: 'ಆಶಾ' }, strings: {
    morning: 'ಶುಭೋದಯ', afternoon: 'ಶುಭ ಮಧ್ಯಾಹ್ನ', evening: 'ಶುಭ ಸಂಜೆ',
    idle: 'ಏನಾದರೂ ಕೇಳಿ', listening: 'ಕೇಳುತ್ತಿದ್ದೇನೆ…', thinking: 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…', speaking: 'ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…',
    helpTitle: 'ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ,', helpSub: 'ನಿಮ್ಮ ಔಷಧಿ, ನಿದ್ದೆ ಅಥವಾ ದಿನದ ಬಗ್ಗೆ ಹೇಳಿ. ನಾನು ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸುತ್ತೇನೆ.',
    placeholder: 'ಅಲೆಕ್ಸಾಗೆ ಹೇಳಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ…', honorific: 'ಅವರೇ',
    suggestions: ['ಶುಭೋದಯ', 'ನಾನು ನನ್ನ {med} ತೆಗೆದುಕೊಂಡೆ', 'ನಿನ್ನೆ ರಾತ್ರಿ ನನಗೆ ಸರಿಯಾಗಿ ನಿದ್ದೆ ಬರಲಿಲ್ಲ', 'ಇಂದು ಏನಿದೆ?', 'ಇಂದು ನನಗೆ ಆರೋಗ್ಯ ಸರಿಯಿಲ್ಲ', 'ಶುಕ್ರವಾರ ನನಗೆ ವಾಹನ ಬೇಕು ಎಂದು ಕುಟುಂಬಕ್ಕೆ ಹೇಳಿ'] } },
]

export const DEFAULT_LANG = 'en-IN'
export const langByCode = (code: string) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]

export function greetingFor(lang: Language, d = new Date()) {
  const h = d.getHours()
  return h < 12 ? lang.strings.morning : h < 17 ? lang.strings.afternoon : lang.strings.evening
}

/** "Asha" -> "आशा जी" in Hindi, "Asha ji" in English. Unknown names stay in Latin script. */
export function addressName(first: string, lang: Language) {
  return `${lang.nameInScript[first] ?? first} ${lang.strings.honorific}`
}

/** Fill the `{med}` placeholder with the patient's own first medicine; drop a chip that needs one when they have none. */
export function suggestionsFor(lang: Language, medicine: string | null): string[] {
  return lang.strings.suggestions.flatMap((s) => (s.includes('{med}') ? (medicine ? [s.replace('{med}', medicine)] : []) : [s]))
}

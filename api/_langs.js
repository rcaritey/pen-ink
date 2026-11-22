// Languages WellHeard can speak, listen and write in.
// code -> [name for Claude, listening locale (Azure), voice (Azure neural)]
// Chosen from the languages most spoken at home in the Toronto area (2021 census) plus Canada's two official languages.
export const LANGS = {
  en: ['English', 'en-CA', 'en-CA-Liam:DragonHDOmniLatestNeural'],
  fr: ['Canadian French', 'fr-CA', 'fr-CA-SylvieNeural'],
  zh: ['Simplified Chinese (Mandarin)', 'zh-CN', 'zh-CN-XiaoxiaoNeural'],
  yue: ['Traditional Chinese, as spoken in Cantonese', 'zh-HK', 'zh-HK-HiuMaanNeural'],
  pa: ['Punjabi (Gurmukhi script)', 'pa-IN', 'pa-IN-OjasNeural'],
  es: ['Spanish', 'es-MX', 'es-MX-DaliaNeural'],
  tl: ['Tagalog (Filipino)', 'fil-PH', 'fil-PH-BlessicaNeural'],
  ar: ['Arabic', 'ar-EG', 'ar-EG-SalmaNeural'],
  it: ['Italian', 'it-IT', 'it-IT-ElsaNeural'],
  pt: ['European Portuguese', 'pt-PT', 'pt-PT-RaquelNeural'],
  ta: ['Tamil', 'ta-IN', 'ta-IN-PallaviNeural'],
  ur: ['Urdu', 'ur-PK', 'ur-PK-UzmaNeural'],
  fa: ['Persian (Farsi)', 'fa-IR', 'fa-IR-DilaraNeural'],
  ru: ['Russian', 'ru-RU', 'ru-RU-SvetlanaNeural'],
  ko: ['Korean', 'ko-KR', 'ko-KR-SunHiNeural'],
  vi: ['Vietnamese', 'vi-VN', 'vi-VN-HoaiMyNeural'],
  hi: ['Hindi', 'hi-IN', 'hi-IN-SwaraNeural'],
  gu: ['Gujarati', 'gu-IN', 'gu-IN-DhwaniNeural'],
  pl: ['Polish', 'pl-PL', 'pl-PL-ZofiaNeural'],
  uk: ['Ukrainian', 'uk-UA', 'uk-UA-PolinaNeural'],
  el: ['Greek', 'el-GR', 'el-GR-AthinaNeural'],
};
// a voice that can read most languages, used when a language's own voice isn't available
export const MULTI = 'en-US-AvaMultilingualNeural';

/**
 * Lightweight voice/text bot commands (ported from new zello app).
 * Used after the bot name is stripped from the transcript.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const WEATHER_CODES = new Map([
  [0, 'clear sky'],
  [1, 'mainly clear'],
  [2, 'partly cloudy'],
  [3, 'overcast'],
  [45, 'fog'],
  [48, 'freezing fog'],
  [51, 'light drizzle'],
  [53, 'drizzle'],
  [55, 'heavy drizzle'],
  [61, 'light rain'],
  [63, 'rain'],
  [65, 'heavy rain'],
  [71, 'light snow'],
  [73, 'snow'],
  [75, 'heavy snow'],
  [80, 'light showers'],
  [81, 'showers'],
  [82, 'heavy showers'],
  [95, 'thunderstorm'],
  [96, 'thunderstorm with hail'],
  [99, 'heavy thunderstorm with hail']
]);

async function fetchJson(url, timeoutMs = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}

function number(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(digits).replace(/\.0+$/, '');
}

class WeatherService {
  constructor(env = process.env) {
    this.env = env;
    this.cache = new Map();
  }

  defaultLocation() {
    return this.env.WEATHER_DEFAULT_LOCATION || 'London';
  }

  async geocode(location) {
    const query = String(location || this.defaultLocation()).trim();
    if (!query) throw new Error('location required');
    const cacheKey = `geo:${query.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.value;

    const url = new URL(GEOCODE_URL);
    url.searchParams.set('name', query);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');

    const data = await fetchJson(url, 10000);
    const place = Array.isArray(data.results) ? data.results[0] : null;
    if (!place) throw new Error(`could not find ${query}`);

    const value = {
      name: place.name,
      admin1: place.admin1 || '',
      country: place.country || '',
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || 'auto'
    };
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    return value;
  }

  async current(location) {
    const place = await this.geocode(location);
    const lat = place.latitude;
    const lon = place.longitude;
    const cacheKey = `weather:${lat},${lon}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.value;

    const url = new URL(FORECAST_URL);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m'
    );
    url.searchParams.set('timezone', place.timezone || 'auto');

    const data = await fetchJson(url, 10000);
    const current = data.current || {};
    const units = data.current_units || {};
    const code = Number(current.weather_code);
    const label = WEATHER_CODES.get(code) || 'unusual weather';
    const temp = number(current.temperature_2m, 0);
    const feels = number(current.apparent_temperature, 0);
    const wind = number(current.wind_speed_10m, 0);
    const hum = number(current.relative_humidity_2m, 0);

    const placeName = [place.name, place.admin1, place.country]
      .filter(Boolean)
      .join(', ');

    const spoken = [
      `In ${placeName} it's ${label}`,
      temp != null
        ? `${temp}${units.temperature_2m || '°C'}${
            feels != null && feels !== temp ? `, feels like ${feels}` : ''
          }`
        : null,
      wind != null ? `wind ${wind}${units.wind_speed_10m || ' km/h'}` : null,
      hum != null ? `humidity ${hum}%` : null
    ]
      .filter(Boolean)
      .join('. ');

    const value = { placeName, spoken, label, temp, feels, wind, hum };
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    return value;
  }
}

function parseStopCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (
    /^(?:stop|stop\s+(?:talking|chat|chatting|please)|enough|shut\s+up|quiet|go\s+away|end\s+chat|bye|goodbye)[.!?]*$/i.test(
      raw
    ) ||
    /\b(?:stop\s+(?:talking|chat|chatting)|end\s+chat|shut\s+up)\b/i.test(raw) ||
    /^(?:(?:bots?|but|bought|please|ok(?:ay)?|hey)[\s,]+)*(?:stop|cancel|kill|end)\s+(?:(?:the|that|this)\s+)?(?:music|song|track|tune|playing|playback|youtube|audio|it)(?:\s+please)?[.!?]*$/i.test(
      raw
    ) ||
    /^(?:turn|switch)\s+(?:(?:the|that)\s+)?(?:music|song|it)\s+off(?:\s+please)?[.!?]*$/i.test(raw) ||
    /^music\s+off[.!?]*$/i.test(raw)
  ) {
    return { action: 'stop' };
  }
  return null;
}

// Abbreviations whose dot must not end a sentence ("play Mr. Brightside")
const SENTENCE_ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|feat|ft|No|Vol)\./gi;

function splitSentences(text) {
  return String(text || '')
    .replace(SENTENCE_ABBREV, '$1')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// Filler allowed before the verb: openers, the "bot" wake (and STT misses: but/bought/boat),
// "AI", politeness. Anything else in front ("I play", "did you play", "the play") is chat.
const PLAY_LEAD =
  '^(?:(?:hey|hi|hello|yo|oi|ok(?:ay)?|right|so|and|now|um+|uh+|erm?|mate|bots?|but|bought|boat|butt|ai|a\\.?\\s?i\\.?|please|just|go\\s+on|(?:can|could|would|will)\\s+(?:you|we))[\\s,;:!.-]+)*';
const PLAY_VERB = '(play|(?:put|stick|bang|chuck|pop)\\s+on)';

// Whole query that means "play" is a verb, not a song request
const PLAY_QUERY_REJECT =
  /^(?:(?:it|that|this|them|him|her|me|us|you)(?:\s+(?:again|back|cool|safe|by\s+ear|out|down|up|game|one|then|now|later))?|on|up|out|off|away|along|around|together|again|later|now|online|outside|inside|nice|fair|dead|safe|rough|dirty|hard|well|properly|ball|pool|cards|golf|tennis|football|rugby|cricket|(?:the\s+)?(?:guitar|piano|drums?|violin|bass|trumpet|sax(?:ophone)?|keyboard|keys)|\d{1,2}|[a-h]\s?[1-8](?:\s+[a-h]\s?[1-8])?)$/i;
// Query starts that mean a game / chat, not a song
const PLAY_QUERY_REJECT_START =
  /^(?:was|is|are|were|with|by|against|for|(?:a|another|the|some|any)\s+(?:games?|round|match|hand)|games?)\b/i;
// "put on your coat" / "stick on the kettle"
const PUT_ON_REJECT =
  /^(?:your|my|his|her|their|our|the\s+kettle|weight|a\s+brave\s+face|a\s+show|clothes|a\s+coat|a\s+jacket|shoes|makeup)\b/i;
const PLAY_TRAILING_FILLER =
  /\s+(?:please|for\s+(?:me|us)|(?:on|from|off)\s+(?:youtube|yt)|thanks|thank\s+you|cheers|mate|bot|yeah|(?:can|could|would|will)\s+you|if\s+you\s+can)$/i;

/**
 * One sentence: "play X" / "bot play X" / "but play, X" / "can you put on X" / "play me some X".
 * The verb must open the sentence (after optional filler) so "I play football" stays chat.
 * → { action: 'play', query } or null.
 */
function parsePlayCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(
    new RegExp(PLAY_LEAD + PLAY_VERB + '(?:[\\s,;:!.-]+|$)(.*)$', 'i')
  );
  if (!m) return null;
  const isPutOn = !/^play$/i.test(m[1]);
  let query = String(m[2] || '')
    .replace(/["“”]/g, ' ')
    .replace(/[,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  query = query
    .replace(/^(?:(?:me|us)\s+)?/i, '')
    .replace(/^(?:(?:from|on|off)\s+(?:youtube|yt)|youtube|yt)\s+/i, '')
    .replace(
      /^(?:some|a\s+bit\s+of|a\s+little|the\s+(?:song|track|tune)|a\s+(?:song|track|tune)\s+called|(?:song|track|tune))\s+/i,
      ''
    )
    .trim();
  for (let i = 0; i < 4; i += 1) {
    query = query.replace(/[\s.!?]+$/g, '').replace(PLAY_TRAILING_FILLER, '').trim();
  }
  if (!query || query.length < 2) return null;
  if (PLAY_QUERY_REJECT.test(query) || PLAY_QUERY_REJECT_START.test(query)) return null;
  if (isPutOn && PUT_ON_REJECT.test(query)) return null;
  if (/\b(?:chess|hangman|blackjack|connect\s*(?:4|four))\b/i.test(query)) return null;
  if (query.length > 120) query = query.slice(0, 120).trim();
  return { action: 'play', query };
}

/** Play request anywhere in an utterance — the last sentence that is one wins. */
function findPlayCommand(text) {
  const sentences = splitSentences(text);
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const cmd = parsePlayCommand(sentences[i]);
    if (cmd) return cmd;
  }
  return null;
}

function parseHelpCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (
    /^(?:help|commands?|command\s+list|list\s+commands?|what\s+can\s+you\s+do)[.!?]*$/i.test(
      raw
    ) ||
    /\b(?:list|show)\s+(?:me\s+)?(?:all\s+)?(?:bot\s+)?commands?\b/i.test(raw) ||
    /\bwhat\s+(?:bot\s+)?commands?\b/i.test(raw)
  ) {
    return { action: 'help' };
  }
  return null;
}

function formatBotCommandsHelp() {
  return [
    'Say bot OR a bot name (Sugar, Dave, Frank…), then: ask anything, stop, time,',
    'weather CITY, show WORDS, picture WORDS, start chess / hangman / blackjack / connect 4,',
    'play SONG NAME, switch to VOICE NAME (no bot name needed). Say bot commands or Sugar commands for the full list.'
  ].join(' ');
}

function isTimeQuestion(text) {
  return /\b(what(?:'s| is) (?:the )?time|time is it|what time|uk time|british time|current time|date is it|what day|what's the date|whats the time|what(?:'s| is) (?:the )?date)\b/i.test(
    String(text || '')
  );
}

function formatUkTimeReply(botName) {
  const now = new Date();
  const ukTime = now.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const ukDate = now.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const name =
    botName && String(botName).trim()
      ? String(botName).trim() + ' here — '
      : '';
  return `${name}it's ${ukTime} UK time on ${ukDate}.`;
}

function parseWeatherCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let m = raw.match(
    /\b(?:what(?:'s| is)\s+)?(?:the\s+)?(?:weather|temperature|temp|forecast)\s+(?:like\s+)?(?:in|for|at)\s+(.+)$/i
  );
  if (!m) {
    m = raw.match(/\b(?:weather|temperature|temp|forecast)\s+(.+)$/i);
  }
  if (m) {
    let loc = String(m[1] || '')
      .replace(/[.!?]+$/g, '')
      .replace(/\b(?:please|today|now)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!loc || loc.length < 2) loc = 'London';
    return { location: loc.slice(0, 80) };
  }
  if (/\b(?:weather|temperature|temp|forecast)\b/i.test(raw)) {
    return { location: 'London' };
  }
  return null;
}

/**
 * "show us a cat" / "show your bum" / "picture pizza" / "draw a boat"
 * Not: "show commands" (handled by help first).
 */
function parsePictureCommand(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  // Help phrases that contain "show" — leave for help handler
  if (/\bshow\s+(?:me\s+)?(?:the\s+)?(?:bot\s+)?commands?\b/i.test(raw)) {
    return null;
  }

  // STT near-misses: "shall us" / "so us" / "shower" → show us
  raw = raw
    .replace(/\bshall\s+(?:us|me|as)\b/gi, 'show us')
    .replace(/\bso\s+us\b/gi, 'show us')
    .replace(/\bshower\s+(?:us|me)\b/gi, 'show us')
    .replace(/\bshow\s+as\b/gi, 'show us')
    .replace(/\bshow\s+off\b/gi, 'show us');

  let m = raw.match(
    /\b(?:picture|draw|image|paint|sketch|generate)\s+(?:of\s+)?(.+)$/i
  );
  if (!m) {
    // Any "show" + at least one word after (optional us/me)
    m = raw.match(/\bshow(?:\s+us|\s+me)?\s+(.+)$/i);
  }
  if (!m) {
    m = raw.match(/\ba\s+picture\s+of\s+(.+)$/i);
  }
  // Bare adult request after wake already stripped: "your tits" / "your bum"
  if (!m) {
    m = raw.match(/^(?:your\s+)?(tits?|boobs?|breasts?|bum|ass|nude|naked)\b(.*)$/i);
    if (m) {
      m = [m[0], ('your ' + m[1] + ' ' + (m[2] || '')).trim()];
    }
  }
  if (!m) return null;

  let prompt = m[1]
    .replace(/\b(?:please|bot|a\s+picture\s+of|an?\s+image\s+of)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Common STT near-misses for adult picture prompts
  prompt = prompt.replace(/\byour\s+tips\b/gi, 'your tits');
  if (!prompt || prompt.length < 2) return null;
  if (prompt.length > 240) prompt = prompt.slice(0, 240).trim();
  return { action: 'generate', prompt };
}

// Optional opener / "bot" / "AI" wake / politeness before the command
const VOICE_CMD_LEAD =
  '^(?:(?:hey|hi|hello|yo|bots?|ai|a\\.?\\s?i\\.?)\\s+|(?:can|could|would|will)\\s+you\\s+|please\\s+|ok(?:ay)?\\s+|right\\s+|now\\s+|just\\s+|go\\s+on\\s+)*';

// Words that follow "voice" in chat but are never a voice name
const VOICE_NAME_REJECT =
  /^(?:is|was|sounds?|that|this|of|in|on|and|it|so|very|like|back|again|please|louder|quieter|faster|slower|up|down|now|thing|sucks|changed?)\b/i;

/**
 * "change your voice to Tommy" / "switch voice to abby" / "use the trump voice" / "voice Scouse Mikey"
 * → { voice, explicit: true }
 * "switch to Leanne" / "be Doctor Strange" / "talk like trump" (whole utterance, no "voice")
 * → { voice, explicit: false } — caller must require a strict name match.
 * Not: "I love your voice" / "what voice is that" / "change the channel".
 */
function parseVoiceChangeCommand(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  // STT near-misses: "change you voice" / "change your boys to" / "switch voices to"
  raw = raw
    .replace(/[,;:]+/g, ' ')
    .replace(
      /\b(?:you|you're|youre|ya|yer|ur)\s+(?=(?:voices?|boys|boy's|boice|boyce|voys|vois|vice)\b)/gi,
      'your '
    )
    .replace(
      /\b(change|switch|swap|set|use|try)(\s+(?:(?:your|the|my)\s+)?)(?:voices|boys|boy's|boice|boyce|voys|vois|vice)\b/gi,
      '$1$2voice'
    )
    .replace(/\bvoice\s+(?:two|too|2)\b/gi, 'voice to')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    // change your voice to X
    /(?:change|switch|swap|set|turn)\s+(?:(?:your|the)\s+)?voice\s+(?:over\s+)?(?:to|into|for|as)\s+(.+)$/i,
    // switch to the X voice
    /(?:change|switch|swap|go|move)\s+(?:over\s+)?to\s+(?:(?:the|a|an|your)\s+)?(.+?)\s+voice\b.*$/i,
    // use the X voice
    /(?:use|try|put\s+on|go\s+with)\s+(?:(?:the|a|an|your|my)\s+)?(.+?)\s+voice\b.*$/i,
    // use voice X
    /(?:use|try)\s+(?:the\s+)?voice\s+(?:of\s+|called\s+)?(.+)$/i,
    // change voice X (no "to")
    /(?:change|switch|swap|set)\s+(?:your\s+)?voice\s+(.+)$/i,
    // voice X
    /(?:new\s+)?voice\s+(?:to\s+|is\s+now\s+|now\s+)?(.+)$/i
  ];
  // No "voice" said — only short whole-utterance forms
  const implicitPatterns = [
    // switch to Leanne / go to abby / change back to Tommy
    /(?:switch|change|swap|go|move|turn)\s+(?:(?:it|yourself|over|back)\s+)*(?:to|into)\s+(.+)$/i,
    // be Doctor Strange / become sugar
    /(?:be|become)\s+(.+)$/i,
    // talk like trump / sound like Alex
    /(?:talk|sound|speak)\s+like\s+(.+)$/i
  ];

  const all = [
    ...patterns.map((re) => [re, true]),
    ...implicitPatterns.map((re) => [re, false])
  ];
  for (const [re, explicit] of all) {
    const m = raw.match(new RegExp(VOICE_CMD_LEAD + re.source, 'i'));
    if (!m) continue;
    let name = String(m[1] || '').trim();
    for (let i = 0; i < 3; i += 1) {
      name = name
        .replace(/[!?,]+$/g, '')
        .replace(/\.+$/g, '')
        .replace(
          /\s+(?:please|now|mate|thanks|thank\s+you|cheers|instead|then|voice|one)$/i,
          ''
        )
        .replace(/^(?:the|a|an|your|my|that)\s+/i, '')
        .trim();
    }
    const maxWords = explicit ? 5 : 4;
    if (!name || name.length < 2 || name.length > (explicit ? 40 : 30)) return null;
    if (name.split(/\s+/).length > maxWords) return null;
    if (VOICE_NAME_REJECT.test(name)) return null;
    return { action: 'voice', voice: name, explicit };
  }
  return null;
}

const VOICE_FILE_JUNK =
  /^(?:voice-personas|voice-ref-manifest|wav-vs-bots-compare|_new_clones)\b/i;

function voiceWords(name) {
  return String(name || '')
    .replace(/\.wav$/i, '')
    .replace(/([a-z])([A-Z][a-z]{2,})/g, '$1 $2')
    .split(/[\s._\-']+/)
    .map((w) =>
      w
        .toLowerCase()
        .replace(/^mister$/, 'mr')
        .replace(/^doctor$/, 'dr')
        .replace(/[^a-z]/g, '')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/(?:ie|ey|ee)$/, 'y')
        .replace(/([a-z])\1+/g, '$1')
    )
    .filter(Boolean);
}

function voiceKey(name) {
  return voiceWords(name).join('');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

function scoreVoiceName(spoken, voice, strict = false) {
  const s = voiceKey(spoken);
  const v = voiceKey(voice);
  if (!s || !v) return 0;
  if (s === v) return 1;
  let score = similarity(s, v);
  // Strict: whole-name likeness only ("switch to German" must not hit germanUbend)
  if (strict) return score;
  // "trumps" / "leanne forty four" — extra trailing junk after a full name
  if (v.length >= 4 && s.startsWith(v)) score = Math.max(score, 0.9);
  // "scouse" → Scouse Mikey
  if (s.length >= 4 && v.startsWith(s)) {
    score = Math.max(score, 0.75 + (0.2 * s.length) / v.length);
  }
  // "sarah" → American Sarah, "marvin" → marvinIsBack
  for (const tok of voiceWords(voice)) {
    if (tok.length >= 4) score = Math.max(score, similarity(s, tok) * 0.9);
  }
  return score;
}

/**
 * Best OmniVoice voice for a spoken name, or null under threshold.
 * strict: used when "voice" wasn't said — confident whole-name match only.
 */
function matchVoiceName(spoken, voices, { strict = false } = {}) {
  const threshold = strict ? 0.8 : 0.7;
  let best = null;
  for (const v of Array.isArray(voices) ? voices : []) {
    const name = String(v?.name || v?.id || v || '').trim();
    if (!name || VOICE_FILE_JUNK.test(name)) continue;
    const score = scoreVoiceName(spoken, name, strict);
    if (!best || score > best.score) best = { voice: name, score };
  }
  return best && best.score >= threshold ? best : null;
}

/**
 * STT-garbled leading bot name: "Hello AI switch to Leanne" with name "ZELLO+AI"
 * → "switch to Leanne". Null if the first 1–3 words don't sound like any name.
 */
function stripFuzzyLeadingName(text, names) {
  const words = String(text || '').trim().split(/\s+/);
  const keys = (Array.isArray(names) ? names : [])
    .map((n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((k) => k.length >= 4);
  for (let n = Math.min(3, words.length - 1); n >= 1; n -= 1) {
    const head = words
      .slice(0, n)
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (head.length < 4) continue;
    if (keys.some((k) => similarity(head, k) >= 0.75)) {
      return words.slice(n).join(' ');
    }
  }
  return null;
}

/** "Leanne44.wav" → "Leanne", "mr.WoLrUs.wav" → "mr WoLrUs" (for speaking). */
function voiceDisplayName(voice) {
  return String(voice || '')
    .replace(/\.wav$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s*\d+$/, '')
    .trim();
}

module.exports = {
  WeatherService,
  parseStopCommand,
  parseHelpCommand,
  splitSentences,
  parsePlayCommand,
  findPlayCommand,
  formatBotCommandsHelp,
  isTimeQuestion,
  formatUkTimeReply,
  parseWeatherCommand,
  parsePictureCommand,
  parseVoiceChangeCommand,
  matchVoiceName,
  voiceDisplayName,
  stripFuzzyLeadingName
};

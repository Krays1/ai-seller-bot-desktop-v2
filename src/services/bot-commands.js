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
    /\b(?:stop\s+(?:talking|chat|chatting)|end\s+chat|shut\s+up)\b/i.test(raw)
  ) {
    return { action: 'stop' };
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
    'play SONG NAME. Say bot commands or Sugar commands for the full list.'
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

module.exports = {
  WeatherService,
  parseStopCommand,
  parseHelpCommand,
  formatBotCommandsHelp,
  isTimeQuestion,
  formatUkTimeReply,
  parseWeatherCommand,
  parsePictureCommand
};

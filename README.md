# Bot Desktop V2

Operational dark console for multi-bot Zello voice. Sibling of v1 — settings live in `%APPDATA%\ai-seller-bot-desktop-v2` so v1 stays untouched.

## Start

1. Ollama running (This PC or Other PC — set on **Engines**)
2. Double-click **START-ALL.bat** (OmniVoice + STT + app)

Or: `npm start` from this folder after deps are installed.

## Live-first workflow

1. **Roster** — Join / Speak / Name ticks, channel + voice per bot → **Save roster**
2. Top bar → **Connect bots**
3. Stay on **Live** — Heard / Reply / Activity update via push IPC (no 500ms poll)
4. Optional: **Speak as bot** composer (Ctrl+Enter)
5. **Channels** / **Engines** when you need channel list or brain/STT/OmniVoice/Fight

## Views

| View | Purpose |
|------|---------|
| **Live** | Transcript, reply, activity feed, speak-as, audio diag |
| **Roster** | Full-height table; voice picker drawer; bulk Join/Speak |
| **Channels** | Active channels + catalog add |
| **Engines** | Single brain + speech + fight/chat panel |

## Speed

- Main pushes `voice-bot:status-changed` on state/activity
- Activity log is append-only (last ~150 rows)
- Slow Zello/audio fallback poll every 5–8s only

## Import

`node tools/import-from-desktop.js` writes v2 settings. If v2 settings are missing, it seeds merge state from v1 AppData when present.

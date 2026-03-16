# PocketPanel

PocketPanel is a real-time AI debate platform built on Amazon Nova. Two AI agents take opposing positions on any topic and argue it out live with natural, expressive voice — streamed directly to your browser over WebSocket.

Enter a topic. Pick a format. Listen to two minds clash.

## How It Works

1. **You type a topic** — "Should cities ban cars from downtown?"
2. **Nova Lite classifies intent** — debate, argument, teaching, or podcast — and recommends a conversation format from 35 modes.
3. **The session auto-starts.** Two agents are assigned opposing positions.
4. **Nova Sonic generates each turn** — the agent thinks, speaks, and reacts in real-time. Text and audio stream simultaneously over WebSocket.
5. **After the final turn**, Nova Pro produces a structured post-debate synthesis: each side's core position, strongest argument, logical verdict, and follow-up questions.

## Architecture

```
Browser (Next.js)          Custom Node Server
  |                           |
  |  POST /api/classify  -->  Nova Lite (intent + mode selection)
  |  POST /api/start     -->  Creates session, returns WS URL
  |                           |
  |  WebSocket /ws  <-------> Orchestrator turn loop
  |    SPEAKER_CHANGE            |
  |    AUDIO_CHUNK (WAV)    <--  Nova Sonic (bidirectional stream)
  |    TURN_TEXT             <--  Text from Sonic's textOutput events
  |    SESSION_END               |
  |    SYNTHESIS_CHUNK      <--  Nova Pro (post-debate synthesis)
```

### Sonic Agent Mode (default)

Nova Sonic operates as a **full conversational agent**, not a text-to-speech engine. Each agent receives a debate-oriented system prompt with its assigned position and format rules. The user text input contains the opponent's last argument (or the opening topic). Sonic generates its own response — both the words and the voice — with natural prosody, emphasis, and conversational rhythm.

Audio streams to the client in ~200ms PCM-buffered WAV chunks. The transcript is extracted from Sonic's `textOutput` events. Time-to-first-audio is typically under 1 second.

### Fallback: Browser TTS

Set `SONIC_AGENT_MODE=false` and `BROWSER_TTS_ENABLED=true` to fall back to: Nova Pro generates text, Browser Web Speech API reads it aloud. No AWS audio costs, instant availability, robotic voice.

## Features

- **35 conversation modes** across debate, argument, teaching, and podcast categories
- **Real-time streaming audio** — WAV chunks over WebSocket, no polling
- **Live transcript** — text appears as each agent speaks
- **Moderator injection** — type a question mid-conversation to redirect the debate
- **Web search integration** — agents can fact-check claims via Brave Search
- **Post-debate synthesis** — structured analysis streamed after the final turn
- **Opposed position generation** — Nova Pro pre-assigns clear, opposed stances before the debate starts
- **Pause/resume and volume controls**
- **Topic library** — curated starter topics across categories

## Stack

- **Frontend**: Next.js 14 App Router, React, TypeScript
- **Backend**: Custom Node.js server (Next.js + WebSocket upgrade on `/ws`)
- **AI Models**:
  - Amazon Nova Lite — intent classification (tool calling)
  - Amazon Nova Sonic — real-time voice agent (bidirectional streaming)
  - Amazon Nova Pro — dialog generation (fallback), position assignment, post-debate synthesis
- **APIs**: Brave Search (web search tool for fact-checking)
- **Infra**: AWS SDK v3 Bedrock Runtime, in-memory session store

## Project Structure

```
app/                        Next.js pages + API routes
  api/classify/             Intent classification endpoint
  api/start/                Session creation endpoint
  page.tsx                  Main UI — WebSocket client, audio playback, transcript
components/                 React components
  AgentStage.tsx            Live debate viewport (avatars, transcript, synthesis)
  PlayerControls.tsx        Pause, volume, moderator injection
  LandingHero.tsx           Landing section with animated entry
  TopicLibrary.tsx          Curated topic browser
  WaveformVisualizer.tsx    Audio waveform animation
lib/                        Shared logic
  bedrock/audio.ts          Nova Sonic bidirectional streaming (TTS + Agent modes)
  bedrock/dialog.ts         Nova Pro dialog turn generation
  bedrock/positions.ts      Opposed position generation
  bedrock/synthesis.ts      Post-debate synthesis generation
  bedrock/classifier.ts     Intent classification with tool calling
  prompts.ts                All system/user prompt builders
  config.ts                 Runtime configuration from env vars
  modes.ts                  35 conversation mode definitions
  session-store.ts          In-memory session state management
  brave-search.ts           Brave Search API client
server/                     Custom Node server
  orchestrator/             Turn loop, audio streaming, synthesis pipeline
  ws/                       WebSocket server and protocol types
```

## Environment Variables

Create `.env` in the repo root:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET

# Model IDs
BEDROCK_MODEL_ID_INTENT=us.amazon.nova-lite-v1:0
BEDROCK_MODEL_ID_DIALOG=us.amazon.nova-pro-v1:0
BEDROCK_MODEL_ID_TTS_OR_SONIC=amazon.nova-2-sonic-v1:0

# Web search
BRAVE_SEARCH_API_KEY=YOUR_BRAVE_API_KEY

# Audio routing (pick one mode)
SONIC_AGENT_MODE=true          # Sonic as conversational agent (recommended)
BROWSER_TTS_ENABLED=true       # Fallback: browser Web Speech API

# Optional tuning
CONVERSATION_TOTAL_TURNS=8
CONVERSATION_MAX_SECONDS_PER_TURN=28
CONVERSATION_MAX_DURATION_SECONDS=210
AGENT_A_VOICE=matthew
AGENT_B_VOICE=amy
```

### Mode Priority

| `SONIC_AGENT_MODE` | `BROWSER_TTS_ENABLED` | Behavior |
|---|---|---|
| `true` | any | Sonic generates text + audio. Browser TTS skipped. |
| `false` | `true` | Nova Pro generates text. Browser speaks it. |
| `false` | `false` | Nova Pro generates text. Server synthesizes audio via Sonic TTS. |

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build and Start

```bash
npm run build
npm start
```

## WebSocket Protocol

Client connects to `ws://<host>/ws?sessionId=<id>`.

### Server Events

| Event | Description |
|---|---|
| `SESSION_READY` | Session initialized, mode confirmed |
| `SPEAKER_CHANGE` | Agent A or B is about to speak |
| `TURN_TEXT` | Full transcript text for the turn |
| `AUDIO_CHUNK` | Base64 WAV audio with ordering metadata |
| `TOOL_USE` | Agent is performing a web search |
| `TOOL_RESULT` | Web search results returned |
| `SYNTHESIS_CHUNK` | Post-debate synthesis text (streamed) |
| `SESSION_END` | Conversation finished |
| `ERROR` | Something went wrong |

### Client Events

| Event | Description |
|---|---|
| `USER_INJECT` | Moderator question injected mid-conversation |
| `CLIENT_SPEECH_DONE` | Browser TTS finished speaking (Browser TTS mode only) |

## Example Topics

- **Debate**: "Should remote work be the default for knowledge workers?"
- **Argument**: "Argue both sides of banning smartphones in schools."
- **Teaching**: "Teach me how neural networks learn, like I'm a first-year CS student."
- **Podcast**: "Host a podcast episode about whether AI will replace software engineers."

## Notes

- One active session per browser tab.
- No user barge-in or interruption — listen-only by design.
- In-memory session store; sessions are lost on server restart.
- Sonic voice IDs: `matthew`, `tiffany`, `amy`, `olivia`, `lupe`, `carlos`, `ambre`, `florian`, `lennart`, `beatrice`, `lorenzo`, `tina`, `carolina`, `leo`, `kiara`, `arjun`.

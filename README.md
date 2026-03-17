# PocketPanel

Two AI agents. One topic. They argue. You listen.

PocketPanel runs a live voice conversation between two AI agents on any topic you give it. Pick a subject — climate policy, whether remote work killed company culture, pineapple on pizza — and listen two Nova Sonic agents take opposing sides and go at it in real-time. Both speech and text are generated simultaneously, with natural rhythm, emphasis, and conviction. It sounds like two people who actually disagree, not two scripts being narrated.

You can throw a question in mid-debate. The next agent addresses it and keeps arguing. Brave Search grounds the agents on live sources when the topic needs real facts. Once the debate ends, a post-debate analysis breaks down what each side got right.

Built for anyone with dead time and a question worth hearing from both sides.

---

## How it uses Amazon Nova

PocketPanel is built around three Nova models working in concert:

**Nova Lite** classifies your topic and assigns a debate format — structured debate, rapid crossfire, podcast, or explainer. It's fast and cheap, used purely for intent routing before anything expensive runs.

**Nova Sonic** (`nova-2-sonic-v1:0`) is the core of the whole thing. Two instances run per debate, each holding an opposing position. They don't read pre-written text — they generate their own arguments, word by word, with audio and text streaming out simultaneously over a bidirectional WebSocket. This is Nova Sonic operating as a conversational agent, not as a text-to-speech engine.

**Nova Pro** synthesizes a structured post-debate analysis once the session ends: each side's core position, their strongest argument, what they missed, and follow-up questions worth exploring.

---

## Architecture

PocketPanel runs Nova Sonic as a conversational agent. When you enter a topic, the server runs three things before the first word is spoken: Nova Lite classifies the intent and picks a conversation format, Nova Pro generates two sharply opposed position stances for Agent A and Agent B, and (if enabled) Brave Search pulls live sources to ground the agents on real facts.

Then the turn loop starts. Agent A goes first. The orchestrator builds a system prompt carrying A's assigned position, the debate format rules, and voice guidance, then opens a bidirectional WebSocket session to Nova Sonic. The opponent's last argument (or the opening topic on turn 1) is sent as the user input, along with silence audio frames that initialize Sonic's audio pipeline. Sonic generates its own response — the words, the pacing, the conviction — streaming back interleaved `audioOutput` and `textOutput` events as it goes. On the server, PCM chunks off that stream get buffered into ~100ms WAV segments, wrapped with a WAV header, and pushed over the browser WebSocket as base64. The `completionEnd` event signals Sonic is done, the session closes, and the `textOutput` from this turn becomes the user input for the next.

Agent B's turn opens a fresh Sonic session with B's position and A's just-spoken argument. Same flow. The sessions alternate — A, B, A, B — each one stateless and independent, each one picking up exactly where the last left off via the accumulated transcript. Once all turns complete, Nova Pro streams a post-debate synthesis to the browser.

On the client, the Web Audio API's `AudioContext` schedules each incoming WAV chunk against the hardware clock. All `decodeAudioData` calls are serialized through a promise chain so chunks play in strict order with no gaps.

```
User enters topic
  │
  ├─ Nova Lite      → classify intent, assign format (debate / podcast / crossfire / ...)
  ├─ Nova Pro       → generate opposed positions for Agent A and Agent B
  ├─ Brave Search   → (optional) ground agents on live sources
  │
  └─ Turn loop
       │
       ├─ [Turn 1 - Agent A]
       │    open Nova Sonic bidirectional WebSocket
       │    send: system prompt (A's position) + topic as user input + silence frames
       │    receive: audioOutput → ~100ms WAV chunks → browser WebSocket → AudioContext
       │    receive: textOutput → transcript line + input for Agent B's turn
       │    close session
       │
       ├─ [Turn 2 - Agent B]
       │    open Nova Sonic bidirectional WebSocket
       │    send: system prompt (B's position) + A's argument as user input + silence frames
       │    receive: audioOutput + textOutput  (same flow)
       │    close session
       │
       ├─ [Turn 3 - Agent A]  ... and so on
       │
       └─ Nova Pro  → post-debate synthesis streamed to browser
```

---

## Features

- **Real-time voice debate** — two agents, opposing positions, live audio streamed to your browser
- **Natural speech** — Nova Sonic generates its own words with contractions, emphasis, and pacing
- **35 conversation formats** — structured debate, argument, teaching, rapid crossfire, podcast, and more
- **Moderator injection** — type a question or redirect mid-debate without breaking flow
- **Live web grounding** — Brave Search surfaces relevant sources before the debate starts
- **Post-debate analysis** — Nova Pro synthesizes key arguments and a verdict after the session ends
- **Gap-free audio playback** — Web Audio API with hardware-clock scheduling, serialized decode chain
- **Pause/resume** — full stop on both agents, server-side turn advancement held until you resume

---

## Running it yourself

### Prerequisites

- Node.js 18+
- AWS account with Bedrock access and `nova-2-sonic-v1:0` enabled in `us-east-1`
- Brave Search API key (optional — without it, agents argue from priors only)

### Environment setup

Create a `.env` file at the project root:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
BEDROCK_MODEL_ID_INTENT=us.amazon.nova-lite-v1:0
BEDROCK_MODEL_ID_DIALOG=us.amazon.nova-pro-v1:0
BEDROCK_MODEL_ID_TTS_OR_SONIC=amazon.nova-2-sonic-v1:0
BRAVE_SEARCH_API_KEY=your_brave_key

# Recommended: Sonic generates its own text + audio
SONIC_AGENT_MODE=true

# Optional tuning
CONVERSATION_TOTAL_TURNS=8
AGENT_A_VOICE=matthew
AGENT_B_VOICE=amy
```

**Audio mode options:**

| `SONIC_AGENT_MODE` | `BROWSER_TTS_ENABLED` | What happens |
|---|---|---|
| `true` | any | Nova Sonic generates text + audio. Recommended. |
| `false` | `true` | Nova Pro generates text. Browser Web Speech API reads it. Free, robotic. |
| `false` | `false` | Nova Pro generates text. Server synthesizes audio via Sonic TTS. |

### Local dev

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, pick a topic, hit Start.

### Docker

```bash
docker build -t pocketpanel .
docker run -p 3000:3000 --env-file .env pocketpanel
```

---

## Built with

- Amazon Nova Lite, Nova Sonic, Nova Pro (via Amazon Bedrock)
- Brave Search API
- Next.js 14, React, TypeScript
- Node.js WebSocket server
- Web Audio API
- Tailwind CSS
- Railway (deployment)

---

## What's next

Custom voices — letting users pick agents that sound like specific characters or personas. Domain-specific agents tuned for law, medicine, or finance. Multi-language debates. Audience voting that shifts agent behavior mid-debate. The orchestration layer is already multi-agent; scaling is an orchestration problem, not a rewrite.

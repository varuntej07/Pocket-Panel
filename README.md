# PocketPanel MVP

PocketPanel is a Next.js + TypeScript web app where a user enters a prompt, gets intent-classified via Amazon Nova tool calling, selects from 35 conversation modes, then listens to a real-time two-agent voice exchange streamed over WebSocket.

## Features

- Prompt classification with Bedrock tool calling (`classify_intent`)
- 35 selectable conversation modes across:
  - `debate`
  - `argument`
  - `teaching`
  - `podcast`
- Loading overlay with spinner + rotating quotes
- Two-agent alternating conversation orchestration (A/B turn-taking)
- Audio chunk streaming over WebSocket
- Minimal listen-only UI (no transcript rendering)
- In-memory session map for MVP

## Stack

- Next.js App Router + TypeScript
- API routes:
  - `POST /api/classify`
  - `POST /api/start`
- Custom Node server for Next + WebSocket upgrade endpoint `/ws`
- AWS SDK v3 Bedrock Runtime client
- Zod validation for tool output and API payloads

## Project Structure

- `app/` UI + API routes
- `components/` reusable client components
- `lib/` config, modes, prompts, Bedrock clients, schemas, session store
- `server/ws/` WebSocket server and protocol
- `server/orchestrator/` two-agent turn loop and streaming pipeline

## Environment Variables

Use the single `.env` file in repo root:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET

# Recommended for us-west-2/us-east-* with Nova:
BEDROCK_MODEL_ID_INTENT=us.amazon.nova-lite-v1:0
BEDROCK_MODEL_ID_DIALOG=us.amazon.nova-pro-v1:0
BEDROCK_MODEL_ID_TTS_OR_SONIC=amazon.nova-2-sonic-v1:0

# Optional explicit inference-profile envs (take precedence if set):
BEDROCK_INFERENCE_PROFILE_ID_INTENT=
BEDROCK_INFERENCE_PROFILE_ID_DIALOG=
BEDROCK_INFERENCE_PROFILE_ID_TTS_OR_SONIC=
```

## AWS Credentials

Use one of:

- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` in `.env`
- AWS shared credentials/profile on your machine
- IAM role (if running on AWS compute)

Ensure Bedrock model access is enabled for each configured model ID or inference profile ID.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build and Start

```bash
npm run build
npm run start
```

## API Contracts

### `POST /api/classify`

Input:

```json
{ "prompt": "Should AI replace homework?" }
```

Output:

```json
{
  "intent": "debate",
  "modes": [
    {
      "id": "debate-rapid-fire-crossfire",
      "title": "Rapid Fire Crossfire",
      "category": "debate",
      "description": "Fast claim-counterclaim rounds with tight timing.",
      "formatGuidance": "Short statements, immediate rebuttals, one supporting detail per turn.",
      "recommended": true
    }
  ]
}
```

### `POST /api/start`

Input:

```json
{
  "prompt": "Should AI replace homework?",
  "modeId": "debate-rapid-fire-crossfire"
}
```

Output:

```json
{
  "sessionId": "uuid",
  "wsUrl": "ws://localhost:3000/ws?sessionId=uuid"
}
```

## WebSocket Protocol

Client connects to:

`ws://<host>/ws?sessionId=<sessionId>`

Server emits:

- `SESSION_READY`
- `SPEAKER_CHANGE`
- `AUDIO_CHUNK`
- `SESSION_END`
- `ERROR`

`AUDIO_CHUNK` is JSON with base64 audio bytes and ordering metadata:
- `turnIndex`
- `segmentIndex`
- `chunkIndex`
- `isFinalChunk`
- `isFinalSegment`

## Config Tuning

Edit `lib/config.ts` to tune:

- total turns
- max seconds per turn
- max session duration
- timeout/retry behavior
- voice IDs
- audio format settings

## Example Prompts

- Debate: `Debate whether remote work improves long-term productivity for startups.`
- Argument: `Argue both sides of banning phones in high school classrooms.`
- Teaching: `Teach me quantum entanglement like I am a first-year CS student.`
- Podcast: `Do a host-guest podcast about AI copilots and developer workflow changes.`

## Notes

- One active session per browser tab is the intended MVP behavior.
- No user barge-in or interruption handling is implemented by design.
- UI intentionally avoids showing full transcript; playback-first experience only.
- Nova 2 Sonic uses the bidirectional stream API contract, and this project wraps the returned LPCM bytes into WAV for browser playback.
- Nova 2 Sonic uses region-agnostic model IDs (for example, `amazon.nova-2-sonic-v1:0`) and not `us.`/`global.` inference-profile-prefixed IDs.
- For text models in US regions (for example Nova Lite/Pro), inference profile IDs such as `us.amazon.nova-lite-v1:0` are commonly required.

# Examlyra

*Turn your notes into exam-ready practice.*

Examlyra turns study notes into multiple-choice quizzes, with a user-selected count from 1 to 100. If the notes cannot support that many distinct questions, generation asks for more detail or a lower count. The app includes a demo question bank, answer explanations, mistake review, retries, saved quiz history, and an optional server-side Gemini quiz generator.

## Requirements

- Node.js 22.15+ (the start script uses Node's `--env-file-if-exists` flag)
- npm

## Local setup

```sh
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed in the terminal. Vite serves the React app and forwards `/api/generate` to the server-side handler. Without an API key, Examlyra opens a clearly marked sample quiz after you submit notes. Add a valid key to enable AI generation:

```dotenv
GEMINI_API_KEY=your-secret-key
GEMINI_MODEL=gemini-3.8-flash
```

Restart the development server after changing `.env`. Create a Gemini API key in Google AI Studio. The key is read only by `api/generate.mjs` and must never use a `VITE_` prefix. The browser receives quiz content, never the key. AI requests are sent to Google Gemini and may be subject to provider quotas or charges under your account. You choose whether to configure credentials; the demo works without them.

## Commands

```sh
npm run lint       # ESLint
npm run typecheck  # TypeScript project checks
npm test           # Quiz/storage and generation API validation tests
npm run build      # Type-check and create dist/
```

## Production deployment

This MVP uses a small Node server for both the generated static files and `/api/generate`; deploy it to a Node hosting service that supports a persistent HTTP process. It is not a static-only deployment.

```sh
npm ci
npm run build
npm start
```

Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) as server-side environment secrets in the host dashboard, and set `PORT` if the host requires a specific port. Do not commit `.env`. The included `server.mjs` serves the `dist/` directory and the generation endpoint on the same origin. Configure the host to run `npm start` after `npm run build`. For Vercel, Netlify, or another serverless platform, adapt `/api/generate` to that platform's function convention before deploying.

### Protecting the generation endpoint

The endpoint accepts unauthenticated requests so the browser app can work without accounts. It applies in-process limits of 5 requests and 100 requested questions per client per 60 seconds, plus 50 requests and 500 questions per server process per UTC day by default. Set `API_RATE_LIMIT_REQUESTS`, `API_RATE_LIMIT_QUESTIONS`, and `API_RATE_LIMIT_WINDOW_MS` to change the per-client limits. Set `API_DAILY_REQUESTS` and `API_DAILY_QUESTIONS` to change the aggregate limits. The request body and notes length are also capped.

The built-in limiter is a per-process safeguard. It resets when the server restarts and does not share counts between multiple server instances, so it is not a guaranteed provider spend cap. Before making the site public, also enable request rate limiting at the hosting edge and configure API project usage alerts or limits. Behind a reverse proxy, requests may appear to come from the proxy address; set `TRUSTED_CLIENT_IP_HEADER` only to a header your host overwrites with the verified visitor IP. Never trust a client-supplied forwarding header.

If an API key was ever pasted into chat, committed, or exposed in a screenshot, revoke it and create a replacement before deployment. Add the replacement only to your host's secret manager. Verify that `.env` remains ignored and is not in the repository before pushing changes.

After deployment, confirm that the homepage loads, the sample quiz works, and one small AI quiz succeeds. Confirm that invalid requests are rejected and repeated requests receive HTTP 429. AI generation needs API-platform billing and model access; a ChatGPT subscription alone does not provide API credit. Never publish the Vite development server.

## Data and privacy

Saved quizzes and the in-progress attempt are stored in this browser's local storage and session storage. Notes are sent to Google Gemini only when the generation endpoint has been configured and a quiz is requested. In demo mode, the bundled sample questions are used. There is no account or cloud sync in this MVP.

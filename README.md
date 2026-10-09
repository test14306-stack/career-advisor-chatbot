# Career Advisor Chatbot

Node.js app: chat UI + secure backend that streams replies from any OpenAI-compatible API.
The API key stays on the server; chat history lives only in the visitor's browser tab.

## Deploy (Render, free tier works)
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > connect the repo.
   Build command: `npm install`   Start command: `npm start`
3. Environment variables: `AI_API_KEY` (required). Optional: `AI_MODEL`, `AI_BASE_URL`, `RATE_LIMIT_PER_MIN`.
4. Deploy. Render gives you an https://<name>.onrender.com URL.
Railway, Fly.io and Azure App Service work the same way.

## Customise
- Name, welcome text, starter questions, privacy notice, system prompt: edit `config.json`, redeploy.
- Knowledge base: add PDF/DOCX/TXT/MD files to `knowledge/`, redeploy (about 60,000 characters are used).
- Switch provider: set `AI_BASE_URL` and `AI_MODEL` (any OpenAI-compatible endpoint).

## Limits
- Knowledge base is passed in full with each request, not searched; very large document sets need retrieval (embeddings).
- No admin web page; admin = whoever can edit the repo or hosting settings.
- Rate limiting is per server instance, per IP.

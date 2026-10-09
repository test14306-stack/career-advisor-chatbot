import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { AI_API_KEY, AI_BASE_URL = "https://api.openai.com/v1", AI_MODEL = "gpt-4o-mini",
  PORT = 3000, RATE_LIMIT_PER_MIN = 20 } = process.env;
if (!AI_API_KEY) console.warn("WARNING: AI_API_KEY is not set. Chat requests will fail.");

const MAX_MSG_CHARS = 2000, MAX_TURNS = 30, KB_CHAR_LIMIT = 60000;
const readConfig = async () => JSON.parse(await fs.readFile(path.join(__dirname, "config.json"), "utf8"));

// Knowledge base: every PDF/DOCX/TXT/MD file in ./knowledge, re-read on each start.
async function loadKnowledge() {
  const dir = path.join(__dirname, "knowledge");
  let out = "";
  for (const f of await fs.readdir(dir).catch(() => [])) {
    const p = path.join(dir, f), ext = path.extname(f).toLowerCase();
    try {
      let text = "";
      if ([".txt", ".md", ".csv"].includes(ext)) text = await fs.readFile(p, "utf8");
      else if (ext === ".pdf") text = (await (await import("pdf-parse")).default(await fs.readFile(p))).text;
      else if (ext === ".docx") text = (await (await import("mammoth")).default.extractRawText({ path: p })).value;
      else continue;
      out += `\n\n--- Document: ${f} ---\n${text.trim()}`;
    } catch (e) { console.warn(`Could not read ${f}: ${e.message}`); }
  }
  return out.slice(0, KB_CHAR_LIMIT);
}
const knowledge = await loadKnowledge();
console.log(`Knowledge base: ${knowledge.length} characters loaded.`);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" });
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", async (_req, res) => {
  const { systemPrompt, ...publicCfg } = await readConfig(); // never expose the system prompt
  res.json(publicCfg);
});

app.use("/api/chat", rateLimit({ windowMs: 60_000, limit: Number(RATE_LIMIT_PER_MIN),
  message: { error: "Too many messages. Please wait a minute and try again." } }));

app.post("/api/chat", async (req, res) => {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || !msgs.length || msgs.length > MAX_TURNS * 2)
    return res.status(400).json({ error: "Invalid conversation." });
  const clean = [];
  for (const m of msgs) {
    if (!["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > MAX_MSG_CHARS)
      return res.status(400).json({ error: `Messages must be 1-${MAX_MSG_CHARS} characters.` });
    clean.push({ role: m.role, content: m.content });
  }
  if (clean.at(-1).role !== "user") return res.status(400).json({ error: "Invalid conversation." });
  if (!AI_API_KEY) return res.status(503).json({ error: "The AI service is not configured." });

  const cfg = await readConfig();
  const system = cfg.systemPrompt + (knowledge
    ? `\n\nKnowledge base (prioritise this; if the answer is not here, say so):\n${knowledge}` : "");

  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  try {
    const upstream = await fetch(`${AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, stream: true, messages: [{ role: "system", content: system }, ...clean] }),
    });
    if (!upstream.ok || !upstream.body) {
      console.error("Upstream error", upstream.status, (await upstream.text()).slice(0, 300));
      return res.status(502).json({ error: "The AI service is unavailable right now. Please try again shortly." });
    }
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of upstream.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try { const t = JSON.parse(data).choices?.[0]?.delta?.content; if (t) res.write(`data: ${JSON.stringify(t)}\n\n`); } catch {}
      }
    }
    res.write("event: done\ndata: {}\n\n"); res.end();
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e);
    if (!res.headersSent) res.status(502).json({ error: "The AI service is unavailable right now. Please try again shortly." });
    else { res.write(`event: error\ndata: {}\n\n`); res.end(); }
  }
});

app.listen(PORT, () => console.log(`Chatbot running on port ${PORT}`));

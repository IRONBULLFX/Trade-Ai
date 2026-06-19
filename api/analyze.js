// ============================================================
// TradeHub backend — /api/analyze
// Holds your Anthropic API key SERVER-SIDE and proxies requests.
// Works on Vercel (api/analyze.js), Netlify (with redirect), or any
// Node 18+ host. The browser NEVER sees your key.
//
// Required env var:  ANTHROPIC_API_KEY
// ============================================================

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function buildPrompt(body) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  if (body.type === "trump") {
    return {
      system: `You are a senior macro trader. You analyze Donald Trump's Truth Social posts and political statements for market impact (NAS100, US30, GER40, GOLD). Output EXACTLY this format:
SENTIMENT_SCORE: [1-100, 1=very bearish, 50=neutral, 100=very bullish]
BIAS: [BEARISH/NEUTRAL/BULLISH]
FACTOR_1: [specific factor + market impact]
FACTOR_2: [specific factor + market impact]
FACTOR_3: [specific factor + market impact]
SUMMARY: [2-sentence NY Open implication]
Today is ${today}.`,
      user: `Analyze likely Trump political sentiment impact for today's NY Open. Consider tariffs, dollar comments, Fed pressure, energy policy, geopolitics. Score it and give 3 specific factors.`,
    };
  }

  if (body.type === "fed") {
    return {
      system: `You are a senior macro trader. You analyze Federal Reserve / FOMC communications for market impact (NAS100, US30, GER40, GOLD). Output EXACTLY this format:
SENTIMENT_SCORE: [1-100]
BIAS: [BEARISH/NEUTRAL/BULLISH]
FACTOR_1: [factor + impact]
FACTOR_2: [factor + impact]
FACTOR_3: [factor + impact]
SUMMARY: [2-sentence NY Open implication]
Today is ${today}.`,
      user: `Analyze the current Fed / FOMC stance for today's NY Open. Consider rate path, hawkish vs dovish tone, forward guidance, inflation vs growth. Score the market impact and give 3 factors.`,
    };
  }

  if (body.type === "instrument") {
    return {
      system: `You are a professional technical trader. Give a sharp signal briefing in under 120 words: directional bias, key level, why the setup is valid, one risk. Be direct.`,
      user: `Today is ${today}. Analyze ${body.instrument} for the NY Open. Entry ~${body.entry}, stop ${body.stop}, target ${body.target}. Explain the technical conviction.`,
    };
  }

  // briefing
  const list = (body.instruments || [])
    .map((i) => `${i.label} (entry ~${i.entry}, conviction ${i.conv}%)`)
    .join(", ");
  return {
    system: `You are the lead analyst at a trading signals firm. Produce a concise pre-market NY Open briefing for professional traders. Max 250 words.`,
    user: `Today is ${today}. Generate the full NY Open briefing for: ${list}. Cover macro environment, per-instrument key levels, the main risk to the thesis, and one sentence on what would flip the bias. Be specific and actionable.`,
  };
}

// ---- Vercel / generic Node (req, res) handler ----
// Set ALLOWED_ORIGIN env var to your site, e.g. "https://ironbullfx.com"
// (use "*" only for quick testing — lock it to your domain in production).
module.exports = async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Browser sends a preflight OPTIONS request before the cross-origin POST.
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.statusCode = 500;
    return res.end("Server missing ANTHROPIC_API_KEY");
  }

  // body may already be parsed (Vercel) or a stream (raw Node)
  let body = req.body;
  if (!body || typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }

  const { system, user } = buildPrompt(body);

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.statusCode = upstream.status;
      return res.end("Anthropic error: " + errText.slice(0, 300));
    }

    // Stream plain text chunks back to the browser.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "content_block_delta" && data.delta?.text) {
              res.write(data.delta.text);
            }
          } catch { /* ignore keep-alive lines */ }
        }
      }
    }
    res.end();
  } catch (err) {
    res.statusCode = 500;
    res.end("Backend exception: " + (err?.message || String(err)));
  }
};

// ---- Netlify Functions wrapper (optional) ----
// If deploying to Netlify, also export `handler` in Netlify's format by
// creating netlify/functions/analyze.js that calls this. See SETUP_GUIDE.md.

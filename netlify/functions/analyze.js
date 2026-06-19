// ============================================================
// TradeHub backend for NETLIFY — netlify/functions/analyze.js
// Holds your Anthropic API key server-side. Browser never sees it.
//
// Required env vars (set in Netlify dashboard):
//   ANTHROPIC_API_KEY   your sk-ant-... key
//   ALLOWED_ORIGIN      e.g. https://terminal.ironbullfx.com  (or * for testing)
//
// Netlify's basic functions return the full body at once (no token streaming),
// so the dashboard shows the answer after a short pause instead of word-by-word.
// Functionally identical result.
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
  const list = (body.instruments || [])
    .map((i) => `${i.label} (entry ~${i.entry}, conviction ${i.conv}%)`)
    .join(", ");
  return {
    system: `You are the lead analyst at a trading signals firm. Produce a concise pre-market NY Open briefing for professional traders. Max 250 words.`,
    user: `Today is ${today}. Generate the full NY Open briefing for: ${list}. Cover macro environment, per-instrument key levels, the main risk to the thesis, and one sentence on what would flip the bias. Be specific and actionable.`,
  };
}

exports.handler = async (event) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  const cors = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method not allowed" };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: cors, body: "Server missing ANTHROPIC_API_KEY" };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

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
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return { statusCode: upstream.status, headers: cors, body: "Anthropic error: " + errText.slice(0, 300) };
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
      body: text || "No response",
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: "Backend exception: " + (err?.message || String(err)) };
  }
};

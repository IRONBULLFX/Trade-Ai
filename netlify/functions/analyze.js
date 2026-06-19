// ============================================================
// TradeHub backend for NETLIFY — netlify/functions/analyze.js
// Holds your Anthropic API key server-side. Browser never sees it.
//
// Required env vars (set in Netlify dashboard):
//   ANTHROPIC_API_KEY   your sk-ant-... key
//   ALLOWED_ORIGIN      e.g. https://terminal.ironbullfx.com  (or * for testing)
// ============================================================

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function buildPrompt(body) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const searchRule = `IMPORTANT: Do ONE focused web search (two at most) to find the most recent relevant info, then answer immediately — be fast, you have a 30-second limit. Do NOT refuse or give a "data limitation" disclaimer — search briefly, then base your scores on what you find. If something is unknown after searching, note it in a FACTOR line but still give your best scored read. Today is ${today}.`;

  if (body.type === "trump") {
    return {
      system: `You are a senior macro trader. You analyze Donald Trump's recent Truth Social posts and political statements for market impact (NAS100, US30, GER40, GOLD). ${searchRule}
Output EXACTLY this format and nothing else:
SENTIMENT_SCORE: [1-100, 1=very bearish, 50=neutral, 100=very bullish]
BIAS: [BEARISH/NEUTRAL/BULLISH]
FACTOR_1: [specific factor + market impact]
FACTOR_2: [specific factor + market impact]
FACTOR_3: [specific factor + market impact]
SUMMARY: [2-sentence NY Open implication]`,
      user: `Search for Trump's latest political/market-relevant statements and news, then analyze the likely sentiment impact for today's NY Open. Consider tariffs, dollar comments, Fed pressure, energy policy, geopolitics. Score it and give 3 specific factors.`,
    };
  }
  if (body.type === "fed") {
    return {
      system: `You are a senior macro trader. You analyze the latest Federal Reserve / FOMC communications for market impact (NAS100, US30, GER40, GOLD). ${searchRule}
Output EXACTLY this format and nothing else:
SENTIMENT_SCORE: [1-100]
BIAS: [BEARISH/NEUTRAL/BULLISH]
FACTOR_1: [factor + impact]
FACTOR_2: [factor + impact]
FACTOR_3: [factor + impact]
SUMMARY: [2-sentence NY Open implication]`,
      user: `Search for the most recent Fed / FOMC news, the current Fed Funds rate, latest dot plot, and recent Fed speaker comments, then analyze the stance for today's NY Open. Score the market impact and give 3 factors.`,
    };
  }
  if (body.type === "instrument") {
    return {
      system: `You are a professional technical trader. Search for the latest price action and news on the instrument, then give a sharp signal briefing in under 120 words: directional bias, key level, why the setup is valid, one risk. Be direct. ${searchRule}`,
      user: `Analyze ${body.instrument} for the NY Open. Entry ~${body.entry}, stop ${body.stop}, target ${body.target}. Search for current ${body.instrument} news and price context, then explain the technical conviction.`,
    };
  }
  const list = (body.instruments || [])
    .map((i) => `${i.label} (entry ~${i.entry}, conviction ${i.conv}%)`)
    .join(", ");
  return {
    system: `You are the lead analyst at a trading signals firm. Search for current market and macro news, then produce a concise pre-market NY Open briefing for professional traders. Max 250 words. ${searchRule}`,
    user: `Generate the full NY Open briefing for: ${list}. Search for today's macro/market news first. Cover macro environment, per-instrument key levels, the main risk to the thesis, and one sentence on what would flip the bias. Be specific and actionable.`,
  };
}

exports.handler = async (event) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  const cors = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

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
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 2,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return { statusCode: upstream.status, headers: cors, body: "Anthropic error: " + errText.slice(0, 300) };
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
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

// Cloudflare Worker: OpenAI-compatible secure proxy for JARVIS.
// Configure AI_API_KEY, AI_MODEL, ALLOWED_ORIGIN as Worker secrets/variables.
// Optional AI_BASE_URL defaults to OpenAI's Chat Completions endpoint.
// Optional AI_TIMEOUT_MS sets the upstream timeout (clamped to 1–30 seconds).

const MAX_REQUEST_BYTES = 64 * 1024;

async function readLimitedJson(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("body_too_large");
  }
  if (!request.body) throw new Error("invalid_json");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function corsHeaders(origin, allowed) {
  return {
    "Access-Control-Allow-Origin": origin === allowed ? allowed : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return new Response("Not found", { status: 404 });
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "";
    const headers = corsHeaders(origin, allowed);
    if (request.method === "OPTIONS") {
      if (!allowed || origin !== allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
    }
    if (!allowed || origin !== allowed) {
      return new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers });
    }
    if (!env.AI_API_KEY || !env.AI_MODEL) {
      return new Response(JSON.stringify({ error: "server_not_configured" }), { status: 503, headers });
    }

    // Optional Cloudflare Rate Limiting binding. When configured, fail closed on
    // missing client IP or binding errors so provider spend is not silently unprotected.
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get("CF-Connecting-IP") || "";
      if (!clientIp) {
        return new Response(JSON.stringify({ error: "rate_limit_unavailable" }), { status: 503, headers });
      }
      try {
        const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
        if (!success) {
          return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
        }
      } catch {
        return new Response(JSON.stringify({ error: "rate_limit_unavailable" }), { status: 503, headers });
      }
    }

    let body;
    try {
      body = await readLimitedJson(request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error && error.message === "body_too_large") {
        return new Response(JSON.stringify({ error: "request_too_large" }), { status: 413, headers });
      }
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers });
    }
    if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 8000) {
      return new Response(JSON.stringify({ error: "invalid_message" }), { status: 400, headers });
    }
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const messages = [
      { role: "system", content: "Ты JARVIS — личный русскоязычный ИИ-ассистент. Отвечай полезно, честно и кратко. Не утверждай, что выполнил действия вне чата, если это не подтверждено." },
      ...history.filter(x => x && ["me", "jarvis"].includes(x.kind) && typeof x.text === "string")
        .map(x => ({
          role: x.kind === "me" ? "user" : "assistant",
          // The UI stores display labels in text; remove them before sending context to the model.
          content: x.text.replace(/^(?:Вы|Джарвис):\s*/i, "").slice(0, 5000)
        })),
      { role: "user", content: body.message.trim() }
    ];
    const base = (env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").replace(/\/$/, "");
    const configuredTimeout = Number(env.AI_TIMEOUT_MS);
    const timeoutMs = Math.min(Math.max(configuredTimeout || 20000, 1000), 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream;
    let result;
    try {
      upstream = await fetch(base, {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.AI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.AI_MODEL, messages, temperature: 0.4, max_tokens: 900 }),
        signal: controller.signal
      });
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: "provider_error" }), { status: 502, headers });
      }
      try { result = await upstream.json(); }
      catch {
        return new Response(JSON.stringify({ error: "invalid_provider_response" }), { status: 502, headers });
      }
    } catch {
      if (controller.signal.aborted) {
        return new Response(JSON.stringify({ error: "provider_timeout" }), { status: 504, headers });
      }
      return new Response(JSON.stringify({ error: "provider_unreachable" }), { status: 502, headers });
    } finally {
      clearTimeout(timer);
    }
    const reply = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return new Response(JSON.stringify({ error: "empty_provider_response" }), { status: 502, headers });
    }
    return new Response(JSON.stringify({ reply: reply.trim().slice(0, 8000) }), { status: 200, headers });
  }
};

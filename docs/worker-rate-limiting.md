# JARVIS Worker rate limiting

The Worker supports an optional Cloudflare Rate Limiting binding named `RATE_LIMITER`.

## Configure it in Cloudflare

1. Open **Workers & Pages** and select the JARVIS Worker.
2. Open **Settings → Bindings** (the exact label may vary by dashboard version).
3. Add a **Rate limiting** binding with variable name `RATE_LIMITER`.
4. Choose a conservative starting policy, for example **10 requests per 60 seconds** per key, then save and deploy.
5. Confirm the deployed Worker has the binding and test repeated requests to `/api/chat`.

The code uses Cloudflare's `CF-Connecting-IP` header as the rate-limit key. If the binding is enabled but the client IP is absent, or the binding errors, the Worker returns `503 rate_limit_unavailable` and does not call the AI provider. If the binding is not configured, rate limiting is not active; the Worker continues to operate with the existing origin, payload-size, message-size, and timeout checks.

## Important limitations

- The binding is optional in code; it must be configured in the Cloudflare dashboard to take effect.
- Rate limiting reduces bursts but is not a hard monetary budget. Configure provider-side spending limits/alerts as well.
- Origin checks and CORS are not authentication: non-browser clients can forge an `Origin` header. If the endpoint becomes public, add an appropriate authentication or abuse-prevention layer.
- Cloudflare's rate-limiting behavior is approximate and may take time to propagate. Verify the current binding options and limits in your Cloudflare account before relying on them.
- Do not log API keys or full chat content while debugging rate limits.

## Prompt cost guardrail

The Worker also caps forwarded chat history at 12,000 characters total, considers at most the latest 12 history entries, and limits each history entry to 2,000 characters. The current message is validated separately (up to 8,000 characters). Provider responses larger than 256 KiB are rejected before JSON parsing to bound response buffering. These character limits reduce oversized prompts but are not a precise token or dollar budget; provider-side spending limits and alerts are still required.

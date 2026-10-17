# JARVIS deployment readiness checklist

Use this checklist before exposing the JARVIS Worker to real users. A checked item means you personally verified it in the relevant dashboard or with a live test; repository tests alone do not count as verification.

## 1. Provider configuration

- [ ] Set `AI_MODEL` to a model name supported by the selected provider.
- [ ] Set `AI_BASE_URL` only if using a compatible non-default API endpoint; verify the exact HTTPS URL.
- [ ] Store `AI_API_KEY` as a Worker secret, never in `index.html`, browser storage, or Git.
- [ ] Configure provider-side spending limits or budgets where available.
- [ ] Enable provider usage alerts and verify where alerts are delivered.
- [ ] Send a test prompt and confirm a normal response; confirm provider errors do not expose upstream response bodies.

## 2. Worker access and browser origin

- [ ] Set `ALLOWED_ORIGIN` to the exact published JARVIS origin, with no path and no trailing slash.
- [ ] If the endpoint must not be publicly callable, create a strong random `JARVIS_ACCESS_TOKEN` secret in the Worker.
- [ ] Enter that token only in JARVIS settings on a trusted personal device. The browser stores it in local storage; do not save it on shared devices.
- [ ] Confirm a request with the correct token succeeds and a request with a missing or wrong token returns HTTP 401 when the secret is configured.
- [ ] Confirm the browser's configured HTTPS endpoint is the intended Worker URL ending in `/api/chat`.
- [ ] Remember: CORS and origin checks are browser controls, not authentication. Non-browser clients can forge an `Origin` header.

## 3. Rate limiting and abuse controls

- [ ] In the Cloudflare dashboard, add the optional Rate Limiting binding named exactly `RATE_LIMITER` to this Worker.
- [ ] Choose and save a conservative starting policy appropriate to expected usage (for example, 10 requests per 60 seconds per client IP), then deploy.
- [ ] Confirm the deployed Worker actually has the binding. If it is absent, application-level rate limiting is inactive.
- [ ] Test repeated requests and verify excess requests receive HTTP 429.
- [ ] Verify provider spending limits and alerts independently; request limits are not a guaranteed monetary cap.

## 4. Deployment and live verification

- [ ] Run the repository CI checks and confirm they pass for the intended commit.
- [ ] Deploy the Worker and the static Pages/site frontend separately as applicable; a successful frontend deployment does not prove the Worker was deployed.
- [ ] From the published site, test a normal prompt with the configured token (if enabled).
- [ ] Test a disallowed browser origin and confirm it is rejected.
- [ ] Confirm the Worker responds with HTTP 503 when required server configuration is missing, without contacting the provider.
- [ ] Check recent Worker logs for errors, but do not log API keys, access tokens, or full private chat contents.
- [ ] Confirm monitoring/alerts are available to the person responsible for the deployment.

## 5. Privacy, backup, and recovery

- [ ] Tell users that chat messages sent to the model leave their device and are processed by the selected provider.
- [ ] Remember that history and notes are stored in this browser's local storage, not automatically synced to another device.
- [ ] Export a backup and verify that it can be restored on a test profile before relying on it.
- [ ] Keep a copy of the last known-good Worker configuration and deployment revision without copying secrets into the record.
- [ ] Know how to rotate `AI_API_KEY` and `JARVIS_ACCESS_TOKEN`, redeploy, and remove an exposed token from the browser.

## Status recording

Do not mark the deployment production-ready based only on passing automated tests. Record the verification date, deployed Worker version/commit, frontend URL, who verified it, and any remaining unchecked items in a private operational record. Never include secret values in that record.

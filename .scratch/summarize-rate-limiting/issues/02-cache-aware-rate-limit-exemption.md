# 02: Cache-Aware Rate Limit Exemption

**What to build:** Ensure that requesting a summary for a document that has already been summarized (where `summary` is already cached in the database) does not count towards the user's 5-request rate limit. Because cached responses do not invoke the external Gemini AI API and produce zero LLM cost, users should be free to read cached summaries without consuming their rate-limited quota.

**Blocked by:** 01: User-Scoped Summarize Rate Limiter

**Status:** ready-for-agent

- [ ] Requests to `POST /documents/:id/summarize` for documents with an existing summary (`cached: true`) do not increment the rate limiter counter or consume the user's quota.
- [ ] A user who has exhausted their 5/10min summarization quota on unsummarized documents can still successfully retrieve already-cached summaries with HTTP 200 without receiving a 429 response.
- [ ] Fresh summarization requests (requiring actual Gemini AI processing) continue to increment the counter and trigger 429 when the limit is reached.
- [ ] Integration tests verify that cached hits do not increment the limiter and remain accessible even when rate limited.

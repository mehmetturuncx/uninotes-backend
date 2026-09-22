# 01: User-Scoped Summarize Rate Limiter

**What to build:** Protect the AI text summarization endpoint (`POST /documents/:id/summarize`) against denial of service and LLM quota exhaustion by enforcing a rate limit of 5 requests per 10-minute window per authenticated user. When the limit is exceeded, subsequent requests from that user are blocked with a 429 Too Many Requests response and a clear error message, while requests from other users continue unimpeded.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Authenticated users can perform up to 5 summarization requests within a 10-minute window.
- [x] The 6th summarization request within the same 10-minute window from the same user is rejected with HTTP 429 and `{ message: "Çok fazla özetleme isteği yaptınız. Lütfen 10 dakika sonra tekrar deneyin." }` (or equivalent descriptive message).
- [x] Rate limiting is scoped per user ID (`req.user.id`) rather than shared across the entire IP address, ensuring one user's quota does not impact another user.
- [x] After the 10-minute window expires, the user's limit resets and summarization succeeds again.
- [x] Automated integration tests in `tests/summarize.route.test.ts` verify the 5-request threshold, 429 response structure, and user isolation.

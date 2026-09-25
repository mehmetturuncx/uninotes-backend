# 02: Admin Invite Code Management API

**What to build:** Provide administrative endpoints under `/admin/invites` that allow authenticated administrators to generate single or batch 6-character random hex invitation codes and inspect existing invitation codes and their usage status. Non-admin users are strictly blocked from accessing these endpoints.

**Blocked by:** 01: Schema Extension, First-User Admin Bootstrapping & AdminMiddleware

**Status:** completed

- [x] `/admin` route group is established, guarded by `authMiddleware` and `adminMiddleware`.
- [x] `POST /admin/invites` generates 6-character uppercase hex invitation codes. If `count` is specified in the request body (e.g. `{ count: 5 }`), that many codes are generated in a batch (defaulting to 1 if omitted). Returns HTTP 201 with the created invite codes.
- [x] `GET /admin/invites` retrieves all invitation codes with their status (`id, code, isUsed, usedById, createdAt`), ordered by creation date descending.
- [x] Non-admin authenticated users receive HTTP 403 Forbidden on both endpoints.
- [x] Unauthenticated requests receive HTTP 401 Unauthorized.
- [x] Integration tests verify batch generation, listing, and permission enforcement.

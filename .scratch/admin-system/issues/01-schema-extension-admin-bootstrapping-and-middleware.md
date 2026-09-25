# 01: Schema Extension, First-User Admin Bootstrapping & AdminMiddleware

**What to build:** Extend the system with an admin flag on users, automatically grant the first registered user administrator privileges, include admin status in generated JWT tokens, and provide an `adminMiddleware` guard that halts non-admin requests with a 403 Forbidden response.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] `User` model in `contract.prisma` includes `isAdmin Boolean @default(false)` and migration is emitted.
- [x] During registration (`POST /auth/register`), if no users currently exist in the database, the newly created user is automatically assigned `isAdmin: true`.
- [x] Subsequent registrations when users already exist in the database are assigned `isAdmin: false`.
- [x] Both registration and login issue JWT tokens whose payload contains `isAdmin: boolean`.
- [x] `authMiddleware` attaches `isAdmin` to `req.user` (`{ id, email, isAdmin }`).
- [x] `adminMiddleware` checks `req.user?.isAdmin` and responds with HTTP 403 and `{ message: "Forbidden: Admin access required." }` if the user is not an admin.
- [x] Integration tests in `tests/admin.test.ts` verify first-user bootstrapping, subsequent normal users, and `adminMiddleware` protection.

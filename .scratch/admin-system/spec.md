# UniNotes Admin System Specification

## Overview
This feature introduces administrative privileges to UniNotes. Designed around simplicity and trust (YAGNI), the first registered user is automatically designated as an admin. Admins can generate invitation codes via API and intervene when locked content needs to be cleaned up or overridden.

## Architectural Decisions
1. **Schema**: `User.isAdmin: Boolean @default(false)`
2. **Bootstrapping**: First user to register in an empty database receives `isAdmin: true`.
3. **Authentication**: `isAdmin` boolean is encoded directly into JWT token payload (`{ id, email, isAdmin }`).
4. **Guards**: `adminMiddleware` verifies `req.user?.isAdmin === true`, rejecting unauthorized requests with 403 Forbidden.
5. **Invite Codes**: Administrative endpoints under `/admin/invites` (POST/GET) for generating and viewing invite codes.
6. **Override**:
   - `PATCH /documents/:id/lock`: Admin can lock/unlock any file.
   - `DELETE /documents/:id`: Admin can delete any file.
   - `DELETE /folders/:id?force=true`: Admin can bypass locked document check in cascade deletion.

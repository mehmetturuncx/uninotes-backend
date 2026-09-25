# 03: Admin Override and Force Cascade Deletion

**What to build:** Allow administrators to intervene in locked files and folders: an administrator can toggle lock status or delete any document regardless of ownership, and can force-delete a folder tree containing locked documents by passing `?force=true`.

**Blocked by:** 01: Schema Extension, First-User Admin Bootstrapping & AdminMiddleware

**Status:** completed

- [x] `PATCH /documents/:id/lock`: Administrators can lock or unlock any document, including documents owned by other users.
- [x] `DELETE /documents/:id`: Administrators can delete any document, including documents owned by other users.
- [x] `DELETE /folders/:id?force=true`: When a folder contains locked documents, if an administrator issues the request with `?force=true`, the locked document guard is bypassed and recursive cascade deletion succeeds (HTTP 200).
- [x] Without `?force=true`, even an administrator receives HTTP 400 when attempting to delete a folder containing locked documents (safety default).
- [x] Non-admin users cannot pass `?force=true` to bypass the lock guard (returns HTTP 400 as normal).
- [x] Integration tests verify admin override on document lock, document delete, and force cascade folder deletion.

# 03: File Locking and Relocation Guard

**What to build:** The owner of a document can lock it to prevent other users from moving or deleting it. Any student can organize unlocked documents by moving them between folders, but locked documents can only be moved or deleted by their original uploader.

**Blocked by:** 02: Document-Folder Association and Filtered Listing

**Status:** ready-for-agent

- [ ] `Document` model schema includes an `isLocked: Boolean` field defaulting to `false`.
- [ ] Document owner can toggle lock state via `PATCH /documents/:id/lock` with `{ isLocked: boolean }`.
- [ ] Non-owner attempting to lock/unlock a document receives `403 Forbidden`.
- [ ] Any authenticated student can move an unlocked document via `PATCH /documents/:id/folder` with `{ folderId: string | null }`.
- [ ] Moving to a non-existent `folderId` returns `404 Not Found`.
- [ ] If a document is locked (`isLocked: true`), non-owners attempting to move it receive `403 Forbidden`. The owner can still move their locked document.
- [ ] Deleting a document (`DELETE /documents/:id`) requires ownership; if locked, deletion by non-owner is blocked (`403 Forbidden`).
- [ ] End-to-end tests verify locking, unauthorized lock attempts, moving unlocked files, and lock-protected movement/deletion.

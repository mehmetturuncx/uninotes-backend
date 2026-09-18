# 05: Cascade Folder Deletion with Recursive Lock Guard

**What to build:** Students can delete a folder and all its nested subfolders and documents in one action. If any document anywhere in the deleted folder's subtree is locked by its owner, the entire deletion is blocked to prevent accidental loss of protected notes.

**Blocked by:** 03: File Locking and Relocation Guard, 04: Folder Reparenting and Cycle Guard

**Status:** ready-for-agent

- [ ] Deleting a folder is initiated via `DELETE /folders/:id`.
- [ ] A PostgreSQL `WITH RECURSIVE` CTE query inspects the folder and all its descendant subfolders to discover all contained documents.
- [ ] If ANY document in the entire subtree has `isLocked: true`, the deletion is aborted with `400 Bad Request` or `403 Forbidden` indicating locked files exist.
- [ ] If no locked documents exist in the subtree:
  - All documents within the subtree are deleted from Cloudflare R2 storage.
  - All documents within the subtree are deleted from the database.
  - All descendant subfolders and the target folder are deleted from the database.
- [ ] End-to-end tests verify:
  - Deleting an empty folder.
  - Deleting a nested folder tree with unlocked files (verifying DB and S3 deletion).
  - Attempting to delete a folder tree containing a locked file at shallow or deep levels (verifying abort).

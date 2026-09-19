# 04: Folder Reparenting and Cycle Guard

**What to build:** Students can rename a folder or move a folder hierarchy into another parent folder. The system detects and rejects circular parent references (moving a folder into its own descendant) to guarantee that the folder tree never enters an infinite loop.

**Blocked by:** 01: Folder Creation and Hierarchy Listing

**Status:** completed

- [x] Authenticated users can rename a folder via `PATCH /folders/:id` with `{ name: string }`.
- [x] Authenticated users can move a folder to a new parent (or to root level) via `PATCH /folders/:id` with `{ parentId: string | null }`.
- [x] Moving a folder to a non-existent `parentId` returns `404 Not Found`.
- [x] Circular reparenting is prevented: moving a folder into itself or into any of its descendants returns `400 Bad Request` with an explanatory message.
- [x] End-to-end tests verify renaming, moving to valid parents, moving to root, and detecting circular move attempts across single and multi-level depths.


# 01: Folder Creation and Hierarchy Listing

**What to build:** A student can organize shared notes by creating folders at the root level or inside existing folders, and can retrieve the folder hierarchy tree so that the UI can render a nested directory structure.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] `Folder` model exists in the database schema with `id`, `name`, `parentId` (self-referential hierarchy), timestamps.
- [x] Authenticated users can create a root folder via `POST /folders` with `{ name: string }`.
- [x] Authenticated users can create a nested subfolder via `POST /folders` with `{ name: string, parentId: string }`.
- [x] Creating a subfolder with a non-existent `parentId` returns `404 Not Found`.
- [x] Folder names must be non-empty strings (validation returns `400 Bad Request` if blank).
- [x] Authenticated users can retrieve the folders list or nested tree via `GET /folders`.
- [x] End-to-end tests verify folder creation, subfolder nesting, validation, and hierarchy retrieval.

# 02: Document-Folder Association and Filtered Listing

**What to build:** When uploading a note, a student can assign it to a specific folder or leave it at root level. When browsing notes, students can filter documents by folder so that only documents belonging to the requested folder (or root) are returned.

**Blocked by:** 01: Folder Creation and Hierarchy Listing

**Status:** completed

- [x] `Document` model schema includes an optional `folderId` foreign key referencing `Folder.id`.
- [x] `POST /documents/upload` accepts an optional `folderId` form field.
- [x] Uploading a document with an invalid/non-existent `folderId` returns `404 Not Found`.
- [x] `GET /documents` supports filtering by `folderId` query parameter (`GET /documents?folderId=<id>`).
- [x] `GET /documents?folderId=root` (or query without `folderId`) returns root documents that have no parent folder (`folderId IS NULL`).
- [x] Document list response objects include the `folderId` field.
- [x] End-to-end tests verify uploading into a folder, invalid folderId rejection, and filtered listing.


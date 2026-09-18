# UniNotes — Folder System Specification

Referans doküman: `C:\Users\Mehmet\Documents\Notlarım\Projelerim\UniNotes Folder System.md`

## Mimari Karar Özeti

1. **Temel Felsefe:** Ortak vault mantığı. Klasör seviyesinde yetkilendirme yok. Dosya seviyesinde `isLocked` koruması var.
2. **Şema:**
   - `Folder`: `id`, `name`, `parentId` (`FolderHierarchy` self-relation), `children`, `documents`, `createdAt`, `updatedAt`.
   - `Document`: `folderId`, `isLocked`.
3. **Recursive Kontrol:** Postgres `WITH RECURSIVE` CTE ile derinlik sınırı olmaksızın alt klasörlerdeki kilitli dosya kontrolü.
4. **Döngü Koruması:** Reparent işleminde döngüsel bağımlılık kontrolü (cycle detection).
5. **Admin / Rol Sistemi:** İleride ihtiyaç olursa eklenecek (YAGNI). İlk kullanıcı otomatik admin.

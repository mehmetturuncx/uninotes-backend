import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { db, getPool } from "../prisma/db";
import { deleteFile } from "../services/s3.service";
import { AppError } from "../errors/AppError";

const router = Router();

router.post('/', authMiddleware, async (req, res) => {
    const { name, parentId } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Folder name is required and cannot be empty." });
    }

    if (parentId) {
        const parentFolder = await db.orm.public.Folder.where({
            id: parentId
        }).first();

        if (!parentFolder) {
            return res.status(404).json({ message: "Parent folder not found." });
        }
    }

    const folder = await db.orm.public.Folder.create({
        name,
        parentId: parentId || null
    });
    return res.status(201).json({ folder });
});


router.get('/', authMiddleware, async (req, res) => {
    const user = req.user?.id;

    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }


    const folders = await db.orm.public.Folder.where({}).orderBy(f => f.name.asc()).all();

    return res.status(200).json({ folders });

});

router.patch('/:id', authMiddleware, async (req, res) => {
    const id = req.params.id as string;
    const { name, parentId } = req.body;


    const updateData: { name?: string; parentId?: string | null } = {};
    const folder = await db.orm.public.Folder.where({ id }).first();

    if (!folder) {
        throw new AppError("Folder not found.", 404);
    }

    if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new AppError("Invalid name.", 400);
        }
        updateData.name = name.trim();
    }

    if (parentId !== undefined) {
        if (parentId === id) {
            return res.status(400).json({ message: "Cannot move a folder into itself or its descendants." });
        }

        if (parentId === null) {
            updateData.parentId = null;
        }
        else {
            const targetFolder = await db.orm.public.Folder.where({ id: parentId }).first();

            if (!targetFolder) {
                return res.status(404).json({ message: "Target parent folder not found!" });
            }

            let curr: any = targetFolder;
            while (curr?.parentId) {
                if (curr.parentId === id) {
                    return res.status(400).json({ message: "Cannot move a folder into itself or its descendants." })
                }

                curr = await db.orm.public.Folder.where({ id: curr.parentId }).first();
            }

            updateData.parentId = parentId;
        }
    }
    await db.orm.public.Folder.where({ id }).update(updateData);

    const updatedFolder = await db.orm.public.Folder.where({ id }).first();

    return res.status(200).json({ folder: updatedFolder });


});

router.delete('/:id', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const folderId = req.params.id as string;

    const folder = await db.orm.public.Folder.where({ id: folderId }).first();
    if (!folder) {
        return res.status(404).json({ message: "Folder not found." });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
        // 1. Recursive CTE: Klasörün kendisini ve keyfi derinlikteki tüm alt klasörlerini bul
        const treeResult = await client.query(
            `WITH RECURSIVE folder_tree AS (
                SELECT id FROM "folder" WHERE id = $1
                UNION ALL
                SELECT f.id FROM "folder" f
                INNER JOIN folder_tree ft ON f."parentId" = ft.id
            )
            SELECT id FROM folder_tree;`,
            [folderId]
        );

        const folderIds = treeResult.rows.map(r => r.id);

        // 2. Alt ağaçtaki tüm dokümanları sorgula
        const docsResult = await client.query(
            `SELECT id, url, "isLocked" FROM "document" WHERE "folderId" = ANY($1);`,
            [folderIds]
        );

        // 3. Kilit Koruması: Alt ağaçta herhangi bir kilitli belge varsa silmeyi iptal et
        const hasLockedDoc = docsResult.rows.some(doc => doc.isLocked === true);
        if (hasLockedDoc && (req.query.force !== 'true' || req.user?.isAdmin !== true)) {
            return res.status(400).json({ message: "Cannot delete folder containing locked documents." });
        }

        // 4. S3 / R2 üzerindeki dosyaları sil
        for (const doc of docsResult.rows) {
            if (doc.url) {
                try {
                    await deleteFile(doc.url);
                } catch (e) {
                    console.error("S3 file deletion error during cascade folder delete: ", e);
                }
            }
        }

        // 5. Veritabanındaki dokümanları sil
        await client.query(
            `DELETE FROM "document" WHERE "folderId" = ANY($1);`,
            [folderIds]
        );

        // 6. Foreign key kısıtını engellemek için önce parentId'leri sıfırla, ardından klasörleri sil
        await client.query(
            `UPDATE "folder" SET "parentId" = NULL WHERE id = ANY($1);`,
            [folderIds]
        );
        await client.query(
            `DELETE FROM "folder" WHERE id = ANY($1);`,
            [folderIds]
        );

        return res.status(200).json({ message: "Folder and its contents deleted successfully." });
    } finally {
        client.release();
    }
});

export default router;
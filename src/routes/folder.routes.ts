import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { db } from "../prisma/db";

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

    try {
        const folder = await db.orm.public.Folder.create({
            name,
            parentId: parentId || null
        });
        return res.status(201).json({ folder });
    }
    catch (err) {
        console.error("Create folder error: ", err);
        return res.status(500).json({ message: "Something went wrong while creating folder." });
    }
});


router.get('/', authMiddleware, async (req, res) => {
    const user = req.user?.id;

    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const folders = await db.orm.public.Folder.where({}).orderBy(f => f.name.asc()).all();

        return res.status(200).json({ folders });
    }
    catch (err) {
        console.error("Get folders error: ", err);
        return res.status(500).json({ message: "Something went wrong while getting folders." });
    }
});

router.patch('/:id', authMiddleware, async (req, res) => {
    const id = req.params.id as string;
    const { name, parentId } = req.body;

    try {
        const updateData: { name?: string; parentId?: string | null } = {};
        const folder = await db.orm.public.Folder.where({ id }).first();

        if (!folder) {
            return res.status(404).json({ message: "Folder not found." });
        }

        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({ message: "Invalid name." });
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

                let curr:any = targetFolder;
                while (curr?.parentId) {
                    if (curr.parentId === id) {
                        return res.status(400).json({ message: "Cannot move a folder into itself or its descendants." })
                    }

                    curr = await db.orm.public.Folder.where({ id: curr.parentId }).first();
                }

                updateData.parentId = parentId;
            }
        }
        await db.orm.public.Folder.where({ id }).update( updateData );

        const updatedFolder = await db.orm.public.Folder.where({ id }).first();

        return res.status(200).json({ folder: updatedFolder });
    }
    catch (err) {
        console.error("Move items error: ", err);
        return res.status(500).json({ message: "Something went wrong while moving items." });
    }
});

export default router;
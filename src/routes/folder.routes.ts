import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { db } from "../prisma/db";

const router = Router();

router.post('/', authMiddleware, async (req, res) => {
    const { name, parentId } = req.body;

    if(!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({message: "Folder name is required and cannot be empty."});
    }

    if(parentId) {
        const parentFolder = await db.orm.public.Folder.where({
            id: parentId
        }).first();

        if(!parentFolder) {
            return res.status(404).json({message: "Parent folder not found."});
        }
    }

    try {
        const folder = await db.orm.public.Folder.create({
            name,
            parentId: parentId || null
        });
        return res.status(201).json({folder});
    }
    catch(err) {
    console.error("Create folder error: ",err);
        return res.status(500).json({message: "Something went wrong while creating folder."});
    }    
});


router.get('/',authMiddleware, async(req,res) => {
    const user = req.user?.id;

    if(!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try{
        const folders = await db.orm.public.Folder.where({}).orderBy(f => f.name.asc()).all(); 

        return res.status(200).json({folders});
    }
    catch(err) {
        console.error("Get folders error: ",err);
        return res.status(500).json({message: "Something went wrong while getting folders."});
    }
});

export default router;
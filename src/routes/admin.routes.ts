import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import crypto from 'node:crypto';
import { db } from "../prisma/db";

const router = Router();

router.use(authMiddleware, adminMiddleware);

router.post('/invites', async (req, res) => {
    const rawCount = req.body.count;
    const count = rawCount === undefined ? 1 : rawCount;

    const isInvalid =
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100;

    if (isInvalid) {
        return res.status(400).json({ message: "Bad Request" });
    }

    const createdInvites = [];

    for (let i = 0; i < count; i++) {
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();

        const newInvite = await db.orm.public.InviteCode.create({ code });
        createdInvites.push(newInvite);
    }

    return res.status(201).json({ count: createdInvites.length, invites: createdInvites });
});

router.get('/invites', async (req,res) => {
    const inviteCodes = await db.orm.public.InviteCode.where({}).orderBy(i => i.createdAt.desc()).all();

    return res.status(200).json({invites: inviteCodes});
});

export default router;
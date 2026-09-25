import { authMiddleware } from "../middlewares/auth.middleware";
import { Router } from "express";
import multer from 'multer';
import crypto from 'crypto';
import { uploadFile, deleteFile, getFile } from "../services/s3.service";
import { db, getPool } from "../prisma/db";
import { Queue } from "bullmq";
import { summarizeText } from "../services/ai/gemini.service";
import { summarizeLimiter } from "../middlewares/rateLimiter";
import { AppError } from "../errors/AppError";

const allowed_mime_types = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
});

import IORedis from 'ioredis';

const connection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new IORedis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null
    });

const ocr_queue = new Queue('ocr-queue', {
    connection, defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 1000 }
    }
});

router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
    const user = req.user?.id;
    const folderId = req.body.folderId;

    if (!user) {
        throw new AppError("User could bot be verified!", 401);
    }

    if (!req.file) {
        throw new AppError("File not found!", 400);
    }

    if (folderId) {
        const folderControl = await db.orm.public.Folder.where({
            id: folderId
        }).first();

        if (!folderControl) {
            throw new AppError("Folder not found!", 404);
        }
    }

    if (!allowed_mime_types.includes(req.file.mimetype)) {
        throw new AppError("Unsupported file type...", 400);
    }

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const hashExist = await db.orm.public.Document.where({ hash }).first();
    if (hashExist) {
        throw new AppError("This file already exists!", 409);
    }
    const uploadedFile = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);

    const createdDoc = await db.orm.public.Document.create({
        title: req.file.originalname,
        url: uploadedFile,
        hash: hash,
        size: req.file.buffer.length,
        mimeType: req.file.mimetype,
        userId: user,
        status: "PENDING",
        folderId: folderId || null
    });

    if (createdDoc) {
        await ocr_queue.add('ocr-job', {
            documentId: createdDoc.id,
            url: createdDoc.url,
            mimeType: createdDoc.mimeType
        }, {
            attempts: 3, backoff: {
                type: 'fixed', delay: 1000
            }
        });
    }

    const fileViewUrl = `${req.protocol}://${req.get('host')}/documents/${createdDoc.id}/file`;

    return res.status(201).json({
        document: {
            ...createdDoc,
            url: fileViewUrl
        }
    });
});

router.get('/search', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        throw new AppError("Unauthorized", 401);
    }
    const q = req.query.q as string;
    if (!q) {
        throw new AppError("Search term is required!", 400);
    }

    const client = await getPool().connect();
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
        await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;');
        await client.query("SET client_encoding TO 'UTF8';");

        const queryText = `
            SELECT id, title, url, "mimeType", "status"
            FROM "document"
            WHERE (
                -- 1. Exact or Substring with Turkish normalization (unaccent + lower)
                unaccent(LOWER(title)) ILIKE '%' || unaccent(LOWER($1)) || '%' OR
                unaccent(LOWER(COALESCE("textContent", ''))) ILIKE '%' || unaccent(LOWER($1)) || '%' OR
                -- 2. Word similarity with original text (fuzzy matching on words)
                WORD_SIMILARITY($1, title) > 0.3 OR
                WORD_SIMILARITY($1, COALESCE("textContent", '')) > 0.3 OR
                -- 3. Word similarity with unaccented text (for typos on Turkish chars)
                WORD_SIMILARITY(unaccent(LOWER($1)), unaccent(LOWER(title))) > 0.3 OR
                WORD_SIMILARITY(unaccent(LOWER($1)), unaccent(LOWER(COALESCE("textContent", '')))) > 0.3
            )
            ORDER BY GREATEST(
                WORD_SIMILARITY($1, title),
                WORD_SIMILARITY($1, COALESCE("textContent", '')),
                WORD_SIMILARITY(unaccent(LOWER($1)), unaccent(LOWER(title))),
                WORD_SIMILARITY(unaccent(LOWER($1)), unaccent(LOWER(COALESCE("textContent", ''))))
            ) DESC, "createdAt" DESC
            LIMIT 20;
        `;

        const result = await client.query(queryText, [q]);

        const formattedResults = result.rows.map(row => ({
            ...row,
            url: `${req.protocol}://${req.get('host')}/documents/${row.id}/file`
        }));
        return res.status(200).json({ results: formattedResults });
    } finally {
        client.release();
    }
});

router.get('/', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    const folderId = req.query.folderId as string;

    if (!user) {
        throw new AppError("Unauthorized", 401);
    }

    let targetFolderId: string | null = null;

    if (!folderId || folderId === 'root') {
        targetFolderId = null;
    }
    else {
        targetFolderId = folderId;
    }

    const documents = await db.orm.public.Document.where({ folderId: targetFolderId })
        .orderBy(doc => doc.createdAt.desc())
        .all();

    const formattedDocuments = documents.map(doc => ({
        ...doc,
        url: `${req.protocol}://${req.get('host')}/documents/${doc.id}/file`
    }));
    return res.status(200).json({ documents: formattedDocuments });
});

router.get('/:id/file', async (req, res) => {
    const id = req.params.id;

    const document = await db.orm.public.Document.where({ id }).first();

    if (!document || !document.url) {
        throw new AppError("Document not found!", 404);
    }

    const fileBuffer = await getFile(document.url as string);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.send(fileBuffer);
});

router.delete('/:id', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        throw new AppError("Unauthorized", 401);
    }

    const documentId = req.params.id as string;

    const document = await db.orm.public.Document.where({ id: documentId }).first();

    if (!document) {
        throw new AppError("Document not found!", 404);
    }

    if (document?.userId !== user && req.user?.isAdmin !== true) {
        throw new AppError("You do not have permission to delete this file.", 403);
    }

    if (document.url) {
        try {
            await deleteFile(document.url);
        } catch (e) {
            console.error("R2 delete error (continuing with DB delete): ", e);
        }
    }

    await db.orm.public.Document.where({ id: documentId }).delete();

    return res.status(200).json({ message: "Document deleted successfully!" });
});

router.post('/:id/summarize', authMiddleware, summarizeLimiter, async (req, res) => {
    const id = req.params.id as string;

    const doc = await db.orm.public.Document.where({ id }).first();

    if (!doc) {
        throw new AppError("Document not found!", 404);
    }

    if (doc.summary) {
        return res.status(200).json({ summary: doc.summary, cached: true });
    }

    if (doc.status === "FAILED") {
        throw new AppError("Document processing failed. Cannot summarize.", 400);
    }

    if (doc.status !== "COMPLETED") {
        throw new AppError("Document is still processing. Please wait.", 400);
    }

    const nonWhitespaceLength = (doc.textContent || "").replace(/\s/g, "").length;
    if (nonWhitespaceLength < 20) {
        throw new AppError("Document has insufficient text to summarize.", 400);
    }

    const summary = await summarizeText(doc.textContent || "");
    if (!summary) {
        throw new AppError("Failed to generate summary.", 500);
    }

    await db.orm.public.Document.where({ id }).update({ summary });

    return res.status(200).json({ summary, cached: false });
});

router.patch('/:id/lock', authMiddleware, async (req, res) => {
    const { isLocked } = req.body;
    const user = req.user?.id;

    if (!user) {
        throw new AppError("Unauthorized", 401);
    }
    const documentId = req.params.id as string;

    const document = await db.orm.public.Document.where({ id: documentId }).first();

    if (!document) {
        throw new AppError("Document not found!", 404);
    }

    if (document.userId !== user && req.user?.isAdmin !== true) {
        throw new AppError("Forbidden", 403);
    }

    const updatedDoc = await db.orm.public.Document.where({ id: documentId }).update({
        isLocked: Boolean(isLocked)
    });

    return res.status(200).json({ document: updatedDoc });
});

router.patch('/:id/folder', authMiddleware, async (req, res) => {
    const documentId = req.params.id as string;
    const { folderId } = req.body;
    const user = req.user?.id;

    if (!user) {
        throw new AppError("Unauthorized", 401);
    }

    const document = await db.orm.public.Document.where({ id: documentId }).first();

    if (!document) {
        throw new AppError("Document not found!", 404);
    }

    if (document.isLocked && document.userId !== user && req.user?.isAdmin !== true) {
        throw new AppError("Forbidden", 403);
    }

    if (folderId) {
        const targetFolder = await db.orm.public.Folder.where({ id: folderId }).first();

        if (!targetFolder) {
            throw new AppError("Target folder not found.", 404);
        }
    }
    const updatedDoc = await db.orm.public.Document.where({ id: documentId }).update({ folderId: folderId || null });

    return res.status(200).json({ document: updatedDoc });
});

export default router;
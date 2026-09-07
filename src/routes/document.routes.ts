import { authMiddleware } from "../middlewares/auth.middleware";
import { Router } from "express";
import multer from 'multer';
import crypto from 'crypto';
import { uploadFile, deleteFile, getFile } from "../services/s3.service";
import { db, getPool } from "../prisma/db";
import { Queue } from "bullmq";
import { summarizeText } from "../services/ai/gemini.service";

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


    if (!user) {
        return res.status(401).json({ message: "User could bot be verified!" });
    }

    if (!req.file) {
        return res.status(400).json({ message: "File not found!" });
    }

    if (!allowed_mime_types.includes(req.file.mimetype)) {
        return res.status(400).json({ message: "Unsupported file type..." });
    }

    try {
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

        const hashExist = await db.orm.public.Document.where({ hash }).first();
        if (hashExist) {
            return res.status(409).json({ message: "This file already exists!" });
        }
        const uploadedFile = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);



        const createdDoc = await db.orm.public.Document.create({
            title: req.file.originalname,
            url: uploadedFile,
            hash: hash,
            size: req.file.buffer.length,
            mimeType: req.file.mimetype,
            userId: user,
            status: "PENDING"
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
        })
    }
    catch (error) {
        return res.status(500).json({ message: "Something went wrong." });
    }
});

router.get('/search', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const q = req.query.q as string;
    if (!q) {
        return res.status(400).json({ message: "Search term is required!" });
    }

    try {
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
    }
    catch (error) {
        console.error("Search error: ", error);
        return res.status(500).json({ message: "Something went wrong while searching!" });
    }
});

router.get('/', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const documents = await db.orm.public.Document.where({})
            .orderBy(doc => doc.createdAt.desc())
            .all();

        const formattedDocuments = documents.map(doc => ({
            ...doc,
            url: `${req.protocol}://${req.get('host')}/documents/${doc.id}/file`
        }));
        return res.status(200).json({ documents: formattedDocuments });
    } catch (error) {
        console.error("List documents error: ", error);
        return res.status(500).json({ message: "Something went wrong while fetching documents!" });
    }
});

router.get('/:id/file', async (req, res) => {
    const id = req.params.id;

    try {
        const document = await db.orm.public.Document.where({ id }).first();

        if (!document || !document.url) {
            return res.status(404).json({ message: "Document not found!" });
        }

        const fileBuffer = await getFile(document.url as string);
        res.setHeader('Content-Type', document.mimeType);
        res.setHeader('Content-Disposition', 'inline');
        res.send(fileBuffer);
    }
    catch (error) {
        console.error("Get file error: ", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    const user = req.user?.id;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const documentId = req.params.id as string;

    try {
        const document = await db.orm.public.Document.where({ id: documentId }).first();

        if (!document) {
            return res.status(404).json({ message: "Document not found!" });
        }

        if (document?.userId !== user) {
            return res.status(403).json({ message: "You do not have permission to delete this file." });
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
    } catch (error) {
        console.error("Delete document error: ", error);
        return res.status(500).json({ message: "Something went wrong while deleting the document!" });
    }
});

router.post('/:id/summarize', authMiddleware, async (req, res) => {
    const id = req.params.id as string;

    try {
        const doc = await db.orm.public.Document.where({ id }).first();

        if (!doc) {
            return res.status(404).json({ message: "Document not found!" });
        }

        if(doc.summary) {
            return res.status(200).json({ summary: doc.summary, cached: true});
        }

        if (doc.status === "FAILED") {
            return res.status(400).json({ message: "Document processing failed. Cannot summarize." });
        }

        if (doc.status !== "COMPLETED") {
            return res.status(400).json({ message: "Document is still processing. Please wait." });
        }

        const nonWhitespaceLength = (doc.textContent || "").replace(/\s/g, "").length;
        if (nonWhitespaceLength < 20) {
            return res.status(400).json({ message: "Document has insufficient text to summarize." });
        }

        const summary = await summarizeText(doc.textContent || "");
        if (!summary) {
            return res.status(500).json({ message: "Failed to generate summary." });
        }

        await db.orm.public.Document.where({ id }).update({ summary });

        return res.status(200).json({ summary, cached: false });
        
    }
    catch(error) {
        console.error("Summarize error: ", error);
        return res.status(500).json({ message: "Something went wrong while summarizing the document!"});
    }
});

export default router;
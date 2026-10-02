import { Worker, Job } from "bullmq";
import { db } from "../prisma/db";
import { PDFParse } from 'pdf-parse';
import { TesseractOcrProvider } from "../services/ocr/tesseract.provider";
import { isOcrQualityAcceptable, isPdfAcceptable } from "../services/ocr/qualityGate";
import { GeminiVisionOcrProvider } from "../services/ocr/gemini.provider";

export const startOcrWorker = (RedisConnection: any) => {
    const tesseractProvider = new TesseractOcrProvider();
    const geminiProvider = new GeminiVisionOcrProvider();

    const worker = new Worker('ocr-queue', async (job: Job) => {
        const { documentId, url, mimeType } = job.data;

        console.log(`Processing job ${job.id} for document ${documentId}`);

        await db.orm.public.Document
            .where({ id: documentId })
            .update({ status: "PROCESSING" });

        const response = await fetch(url);
        if(!response.ok){
            throw new Error(`Failed to fetch file from storage: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let effectiveMimeType = mimeType;
        if (!effectiveMimeType) {
            if (url?.endsWith('.pdf')) {
                effectiveMimeType = 'application/pdf';
            } else {
                const existingDoc = await db.orm.public.Document.where({ id: documentId }).first();
                effectiveMimeType = existingDoc?.mimeType;
            }
        }

        if (effectiveMimeType === 'application/pdf') {
            const uint8Array = new Uint8Array(arrayBuffer);
            const parser = new PDFParse(uint8Array);
            const result = await parser.getText();
            await parser.destroy();

            const isQualityOk = isPdfAcceptable(result.text);

            if (isQualityOk) {
                await db.orm.public.Document
                    .where({ id: documentId })
                    .update({ status: "COMPLETED", textContent: result.text });
            }
            else {
                console.log(`PDF quality gate failed for ${documentId}, falling back to Gemini Vision...`);

                const aiResult = await geminiProvider.extractText(buffer, effectiveMimeType);

                await db.orm.public.Document
                    .where({ id: documentId })
                    .update({ status: "COMPLETED", textContent: aiResult.text });
            }


        }
        if (effectiveMimeType?.startsWith('image/')) {
            const ocrResult = await tesseractProvider.extractText(buffer, effectiveMimeType);

            const isQualityOk = isOcrQualityAcceptable(ocrResult);
            if (isQualityOk) {
                await db.orm.public.Document
                    .where({ id: documentId })
                    .update({ status: "COMPLETED", textContent: ocrResult.text });
            }
            else {
                console.log(`OCR quality gate failed for doc ${documentId}, falling back to Gemini Vision...`);

                const aiResult = await geminiProvider.extractText(buffer, effectiveMimeType);

                await db.orm.public.Document
                    .where({ id: documentId })
                    .update({ status: "COMPLETED", textContent: aiResult.text });
            }
        }


    }, { connection: RedisConnection });

    worker.on('failed', async (job, err) => {
        if (job) {
            if (job.attemptsMade >= (job.opts.attempts || 3)) {
                await db.orm.public.Document
                    .where({ id: job.data.documentId })
                    .update({ status: "FAILED" });

                console.log(JSON.stringify({
                    event: "JOB_FAILED",
                    traceId: job.data.documentId,
                    error: err.message
                }));
            }
        }
    });

    return worker;
};
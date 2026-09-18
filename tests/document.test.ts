import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

vi.mock('../src/services/s3.service', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://mock-s3-bucket.s3.amazonaws.com/test-doc.pdf')
}));

// BullMQ Queue Mock
export const addMock = vi.fn().mockResolvedValue({ id: 'job-id' });
vi.mock('bullmq', () => {
  return {
    Queue: class {
      add = addMock;
      close = vi.fn().mockResolvedValue(undefined);
    }
  };
});

import { Queue } from 'bullmq';

let app: any;
let db: any;

describe('Document Upload & Deduplication API', () => {
  beforeAll(async () => {
    app = (await import('../src/app')).default;
    db = (await import('../src/prisma/db')).db;
  });

  beforeEach(async () => {
    const { getPool } = await import('../src/prisma/db');
    const pool = getPool();
    await pool.query('TRUNCATE TABLE "folder", "document", "user", "inviteCode" CASCADE;');
    vi.clearAllMocks();
  });

  const getAuthToken = async (email: string, code: string) => {
    await db.orm.public.InviteCode.create({ code });
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123', inviteCode: code });
    return { token: res.body.token, user: res.body.user };
  };

  describe('POST /documents/upload', () => {
    it('Geçerli bir folderId ile dosya yüklendiğinde dosya o klasöre atanmalı', async () => {
      const { token } = await getAuthToken('test_folder_upload@uni.edu', 'CODE_FOLDER_1');
      const folder = await db.orm.public.Folder.create({ name: 'Fizik Notları', parentId: null });
      const fileBuffer = Buffer.from('fizik ders notu');

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('folderId', folder.id)
        .attach('file', fileBuffer, 'fizik.pdf');

      expect(response.status).toBe(201);
      expect(response.body.document).toHaveProperty('folderId', folder.id);
    });

    it('Var olmayan bir folderId ile yükleme yapılmaya çalışıldığında 404 dönmeli', async () => {
      const { token } = await getAuthToken('test_folder_invalid@uni.edu', 'CODE_FOLDER_2');
      const fileBuffer = Buffer.from('gecersiz klasor testi');

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('folderId', '00000000-0000-0000-0000-000000000000')
        .attach('file', fileBuffer, 'gecersiz.pdf');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('message');
    });
    it('Geçerli bir dosya yüklendiğinde S3 mock çağrılmalı, DB ye PENDING kaydedilmeli ve BullMQ kuyruğuna iş eklenmeli', async () => {
      const { token } = await getAuthToken('test1@uni.edu', 'CODE1');
      const fileBuffer = Buffer.from('dummy pdf content');

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileBuffer, 'dummy.pdf');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('document');
      expect(response.body.document).toHaveProperty('status', 'PENDING');
      
      // BullMQ kuyruğuna iş eklendiğini doğrula
      expect(addMock).toHaveBeenCalled();
      const addArgs = addMock.mock.calls[0]!;
      expect(addArgs[0]).toBe('ocr-job'); // İşin adı
      expect(addArgs[1]).toHaveProperty('documentId', response.body.document.id);
      expect(addArgs[1]).toHaveProperty('url', 'https://mock-s3-bucket.s3.amazonaws.com/test-doc.pdf');
    });

    it('Daha önce yüklenmiş aynı hash değerine sahip dosya tekrar yüklenmek istendiğinde 409 dönmeli', async () => {
      const { token, user } = await getAuthToken('test2@uni.edu', 'CODE2');
      const fileBuffer = Buffer.from('conflict content');
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      await db.orm.public.Document.create({
        title: 'Already Existing Doc.pdf',
        hash: hash,
        size: fileBuffer.length,
        mimeType: 'application/pdf',
        userId: user.id,
        url: 'https://mock.url',
        status: 'COMPLETED'
      });

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileBuffer, 'conflict.pdf');

      expect(response.status).toBe(409);
    });

    it('Token olmadan istek atıldığında 401 dönmeli', async () => {
      const fileBuffer = Buffer.from('unauth content');

      const response = await request(app)
        .post('/documents/upload')
        .set('Connection', 'keep-alive')
        .attach('file', fileBuffer, 'unauth.pdf');

      expect(response.status).toBe(401);
    });

    it('Geçerli bir görsel (image/jpeg) yüklendiğinde PENDING kaydedilmeli ve kuyruğa mimeType iletilmeli', async () => {
      const { token } = await getAuthToken('test_img@uni.edu', 'CODE_IMG');
      const fileBuffer = Buffer.from('fake image binary content');

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileBuffer, 'notes.jpg');

      expect(response.status).toBe(201);
      expect(response.body.document).toHaveProperty('status', 'PENDING');
      expect(response.body.document).toHaveProperty('mimeType', 'image/jpeg');

      expect(addMock).toHaveBeenCalled();
      const lastCall = addMock.mock.calls[addMock.mock.calls.length - 1]!;
      expect(lastCall[1]).toHaveProperty('mimeType', 'image/jpeg');
    });

    it('Desteklenmeyen bir dosya türü yüklendiğinde 400 Bad Request dönmeli', async () => {
      const { token } = await getAuthToken('test_invalid@uni.edu', 'CODE_INV');
      const fileBuffer = Buffer.from('console.log("malicious");');

      const response = await request(app)
        .post('/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileBuffer, 'script.exe');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/unsupported/i);
    });
  });

  describe('GET /documents', () => {
    it('Token olmadan istek atıldığında 401 dönmeli', async () => {
      const response = await request(app).get('/documents');
      expect(response.status).toBe(401);
    });

    it('parametre verilmediğinde veya folderId=root olduğunda sadece kök dizindeki (folderId null) belgeleri dönmeli', async () => {
      const { token, user } = await getAuthToken('list_test_root@uni.edu', 'CODE_LIST_1');
      const folder = await db.orm.public.Folder.create({ name: 'Matematik', parentId: null });

      const rootDoc = await db.orm.public.Document.create({
        title: 'root-doc.pdf',
        url: 'http://s3.local/root-doc.pdf',
        hash: 'hash-root-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        folderId: null
      });

      await db.orm.public.Document.create({
        title: 'sub-doc.pdf',
        url: 'http://s3.local/sub-doc.pdf',
        hash: 'hash-sub-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        folderId: folder.id
      });

      // 1. Parametre verilmediğinde (varsayılan: root)
      const resNoParam = await request(app)
        .get('/documents')
        .set('Authorization', `Bearer ${token}`);

      expect(resNoParam.status).toBe(200);
      expect(resNoParam.body.documents).toHaveLength(1);
      expect(resNoParam.body.documents[0].id).toBe(rootDoc.id);
      expect(resNoParam.body.documents[0].folderId).toBeNull();

      // 2. folderId=root verildiğinde
      const resRoot = await request(app)
        .get('/documents?folderId=root')
        .set('Authorization', `Bearer ${token}`);

      expect(resRoot.status).toBe(200);
      expect(resRoot.body.documents).toHaveLength(1);
      expect(resRoot.body.documents[0].id).toBe(rootDoc.id);
      expect(resRoot.body.documents[0].folderId).toBeNull();
    });

    it('folderId=<id> verildiğinde sadece o klasördeki belgeleri dönmeli', async () => {
      const { token, user } = await getAuthToken('list_test_folder@uni.edu', 'CODE_LIST_2');
      const folderA = await db.orm.public.Folder.create({ name: 'Fizik', parentId: null });
      const folderB = await db.orm.public.Folder.create({ name: 'Kimya', parentId: null });

      const docA = await db.orm.public.Document.create({
        title: 'fizik-notu.pdf',
        url: 'http://s3.local/fizik.pdf',
        hash: 'hash-fizik-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        folderId: folderA.id
      });

      await db.orm.public.Document.create({
        title: 'kimya-notu.pdf',
        url: 'http://s3.local/kimya.pdf',
        hash: 'hash-kimya-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        folderId: folderB.id
      });

      const res = await request(app)
        .get(`/documents?folderId=${folderA.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].id).toBe(docA.id);
      expect(res.body.documents[0].folderId).toBe(folderA.id);
    });
  });
});


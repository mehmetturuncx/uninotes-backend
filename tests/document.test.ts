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

  describe('PATCH /documents/:id/lock', () => {
    it('Token olmadan istek atıldığında 401 dönmeli', async () => {
      const response = await request(app)
        .patch('/documents/00000000-0000-0000-0000-000000000000/lock')
        .send({ isLocked: true });
      expect(response.status).toBe(401);
    });

    it('Var olmayan bir belge için 404 dönmeli', async () => {
      const { token } = await getAuthToken('lock_404@uni.edu', 'CODE_LOCK_404');
      const response = await request(app)
        .patch('/documents/00000000-0000-0000-0000-000000000000/lock')
        .set('Authorization', `Bearer ${token}`)
        .send({ isLocked: true });
      expect(response.status).toBe(404);
    });

    it('Dosya sahibi kilit durumunu değiştirebilmeli (isLocked: true/false)', async () => {
      const { token, user } = await getAuthToken('lock_owner@uni.edu', 'CODE_LOCK_OWNER');
      const doc = await db.orm.public.Document.create({
        title: 'kilitli-not.pdf',
        url: 'http://s3.local/kilit.pdf',
        hash: 'hash-lock-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        isLocked: false
      });

      // 1. Kilitle
      const resLock = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isLocked: true });

      expect(resLock.status).toBe(200);
      expect(resLock.body.document.isLocked).toBe(true);

      const dbDocLocked = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDocLocked?.isLocked).toBe(true);

      // 2. Kilidi aç
      const resUnlock = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isLocked: false });

      expect(resUnlock.status).toBe(200);
      expect(resUnlock.body.document.isLocked).toBe(false);

      const dbDocUnlocked = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDocUnlocked?.isLocked).toBe(false);
    });

    it('Dosya sahibi olmayan bir kullanıcı kilit durumunu değiştirmeye çalıştığında 403 dönmeli', async () => {
      const { user: owner } = await getAuthToken('doc_owner@uni.edu', 'CODE_DOC_OWNER');
      const { token: otherToken } = await getAuthToken('doc_other@uni.edu', 'CODE_DOC_OTHER');

      const doc = await db.orm.public.Document.create({
        title: 'baskasinin-notu.pdf',
        url: 'http://s3.local/baskasi.pdf',
        hash: 'hash-lock-2',
        size: 100,
        mimeType: 'application/pdf',
        userId: owner.id,
        status: 'COMPLETED',
        isLocked: false
      });

      const res = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ isLocked: true });

      expect(res.status).toBe(403);

      const dbDoc = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDoc?.isLocked).toBe(false);
    });
  });

  describe('PATCH /documents/:id/folder', () => {
    it('Token olmadan istek atıldığında 401 dönmeli', async () => {
      const response = await request(app)
        .patch('/documents/00000000-0000-0000-0000-000000000000/folder')
        .send({ folderId: null });
      expect(response.status).toBe(401);
    });

    it('Var olmayan bir belge taşınmak istendiğinde 404 dönmeli', async () => {
      const { token } = await getAuthToken('move_doc_404@uni.edu', 'CODE_MOVE_D404');
      const response = await request(app)
        .patch('/documents/00000000-0000-0000-0000-000000000000/folder')
        .set('Authorization', `Bearer ${token}`)
        .send({ folderId: null });
      expect(response.status).toBe(404);
    });

    it('Var olmayan bir klasöre taşınmak istendiğinde 404 dönmeli', async () => {
      const { token, user } = await getAuthToken('move_f_404@uni.edu', 'CODE_MOVE_F404');
      const doc = await db.orm.public.Document.create({
        title: 'move-test.pdf',
        url: 'http://s3.local/move-test.pdf',
        hash: 'hash-move-1',
        size: 100,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        isLocked: false
      });

      const response = await request(app)
        .patch(`/documents/${doc.id}/folder`)
        .set('Authorization', `Bearer ${token}`)
        .send({ folderId: '00000000-0000-0000-0000-000000000000' });

      expect(response.status).toBe(404);
    });

    it('Kilitli olmayan bir belge herhangi bir kullanıcı tarafından başka klasöre ve kök dizine taşınabilmeli', async () => {
      const { user: uploader } = await getAuthToken('uploader@uni.edu', 'CODE_UPLOADER');
      const { token: studentToken } = await getAuthToken('student@uni.edu', 'CODE_STUDENT');

      const folderA = await db.orm.public.Folder.create({ name: 'Hedef Klasör', parentId: null });
      const doc = await db.orm.public.Document.create({
        title: 'unlocked-doc.pdf',
        url: 'http://s3.local/unlocked.pdf',
        hash: 'hash-move-2',
        size: 100,
        mimeType: 'application/pdf',
        userId: uploader.id,
        status: 'COMPLETED',
        folderId: null,
        isLocked: false
      });

      // 1. Hedef klasöre taşı
      const resMove = await request(app)
        .patch(`/documents/${doc.id}/folder`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ folderId: folderA.id });

      expect(resMove.status).toBe(200);
      expect(resMove.body.document.folderId).toBe(folderA.id);

      const dbDocMoved = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDocMoved?.folderId).toBe(folderA.id);

      // 2. Kök dizine geri taşı (folderId: null)
      const resRoot = await request(app)
        .patch(`/documents/${doc.id}/folder`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ folderId: null });

      expect(resRoot.status).toBe(200);
      expect(resRoot.body.document.folderId).toBeNull();

      const dbDocRoot = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDocRoot?.folderId).toBeNull();
    });

    it('Kilitli bir belgeyi sahibi olmayan bir kullanıcı taşımaya çalıştığında 403 dönmeli', async () => {
      const { user: owner } = await getAuthToken('locked_owner@uni.edu', 'CODE_L_OWNER');
      const { token: otherToken } = await getAuthToken('locked_other@uni.edu', 'CODE_L_OTHER');
      const folder = await db.orm.public.Folder.create({ name: 'Gizli Klasör', parentId: null });

      const doc = await db.orm.public.Document.create({
        title: 'locked-doc.pdf',
        url: 'http://s3.local/locked.pdf',
        hash: 'hash-move-3',
        size: 100,
        mimeType: 'application/pdf',
        userId: owner.id,
        status: 'COMPLETED',
        folderId: null,
        isLocked: true
      });

      const res = await request(app)
        .patch(`/documents/${doc.id}/folder`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ folderId: folder.id });

      expect(res.status).toBe(403);

      const dbDoc = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDoc?.folderId).toBeNull();
    });

    it('Kilitli bir belgeyi kendi sahibi başka bir klasöre taşıyabilmeli', async () => {
      const { token: ownerToken, user: owner } = await getAuthToken('owner_mover@uni.edu', 'CODE_O_MOVER');
      const folder = await db.orm.public.Folder.create({ name: 'Sahip Klasörü', parentId: null });

      const doc = await db.orm.public.Document.create({
        title: 'owner-locked-doc.pdf',
        url: 'http://s3.local/owner-locked.pdf',
        hash: 'hash-move-4',
        size: 100,
        mimeType: 'application/pdf',
        userId: owner.id,
        status: 'COMPLETED',
        folderId: null,
        isLocked: true
      });

      const res = await request(app)
        .patch(`/documents/${doc.id}/folder`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ folderId: folder.id });

      expect(res.status).toBe(200);
      expect(res.body.document.folderId).toBe(folder.id);

      const dbDoc = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(dbDoc?.folderId).toBe(folder.id);
    });
  });
});



import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

let app: any;
let db: any;

describe('Folder Management API: POST /folders', () => {
  beforeAll(async () => {
    app = (await import('../src/app')).default;
    db = (await import('../src/prisma/db')).db;
  });

  beforeEach(async () => {
    const { getPool } = await import('../src/prisma/db');
    const pool = getPool();
    await pool.query('TRUNCATE TABLE "folder", "document", "user", "inviteCode" CASCADE;');
  });

  const getAuthToken = async (email: string, code: string) => {
    await db.orm.public.InviteCode.create({ code });
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123', inviteCode: code });
    return { token: res.body.token, user: res.body.user };
  };

  it('Giriş yapmış bir kullanıcı geçerli bir isimle kök dizinde klasör oluşturabilmeli', async () => {
    const { token } = await getAuthToken('student_folder@uni.edu', 'INVITE-FOLDER-1');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ders Notları' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('folder');
    expect(response.body.folder).toHaveProperty('id');
    expect(response.body.folder.name).toBe('Ders Notları');
    expect(response.body.folder.parentId).toBeNull();
  });

  it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
    const response = await request(app)
      .post('/folders')
      .send({ name: 'Ders Notları' });

    expect(response.status).toBe(401);
  });

  it('Klasör adı boş veya sadece boşluklardan oluşuyorsa 400 Bad Request dönmeli', async () => {
    const { token } = await getAuthToken('student_folder2@uni.edu', 'INVITE-FOLDER-2');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
  });

  it('Var olan bir klasörün altına alt klasör (nested subfolder) oluşturabilmeli', async () => {
    const { token } = await getAuthToken('student_folder3@uni.edu', 'INVITE-FOLDER-3');

    // 1. Ana klasörü oluştur
    const parentRes = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mühendislik' });

    const parentId = parentRes.body.folder.id;

    // 2. Alt klasörü oluştur
    const subRes = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bilgisayar', parentId });

    expect(subRes.status).toBe(201);
    expect(subRes.body.folder.name).toBe('Bilgisayar');
    expect(subRes.body.folder.parentId).toBe(parentId);
  });

  it('Var olmayan bir parentId ile alt klasör oluşturulmaya çalışıldığında 404 Not Found dönmeli', async () => {
    const { token } = await getAuthToken('student_folder4@uni.edu', 'INVITE-FOLDER-4');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Yapay Zeka', parentId: 'non-existent-folder-uuid' });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message');
  });

  describe('GET /folders', () => {
    it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
      const response = await request(app).get('/folders');
      expect(response.status).toBe(401);
    });

    it('Tüm klasörleri düz bir liste olarak döndürmeli', async () => {
      const { token } = await getAuthToken('student_list@uni.edu', 'INVITE-FOLDER-5');

      // 1. İki klasör oluştur (biri kök, biri alt klasör)
      const parent = await db.orm.public.Folder.create({ name: 'Mühendislik', parentId: null });
      await db.orm.public.Folder.create({ name: 'Bilgisayar', parentId: parent.id });

      // 2. Klasörleri listele
      const response = await request(app)
        .get('/folders')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('folders');
      expect(Array.isArray(response.body.folders)).toBe(true);
      expect(response.body.folders.length).toBe(2);

      const folderNames = response.body.folders.map((f: any) => f.name);
      expect(folderNames).toContain('Mühendislik');
      expect(folderNames).toContain('Bilgisayar');
    });
  });
});

import { Temporal } from '@js-temporal/polyfill';
(globalThis as any).Temporal = Temporal;
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import documentRoutes from './routes/document.routes';
import folderRoutes from './routes/folder.routes';

const app = express();
app.set('trust proxy',1);
app.use(cors());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/documents',documentRoutes);
app.use('/folders',folderRoutes);

export default app;

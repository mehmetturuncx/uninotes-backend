import { Temporal } from '@js-temporal/polyfill';
(globalThis as any).Temporal = Temporal;
import express from 'express';
import {type Request, type Response, type NextFunction} from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import documentRoutes from './routes/document.routes';
import folderRoutes from './routes/folder.routes';
import { AppError } from './errors/AppError';
import adminRoutes from './routes/admin.routes';

const app = express();
app.set('trust proxy',1);
app.use(cors());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/documents',documentRoutes);
app.use('/folders',folderRoutes);
app.use('/admin', adminRoutes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof AppError ? err.message : 'Something went wrong.';

    if (statusCode >= 500) {
        console.error(err.stack);
    }

    res.status(statusCode).json({
        message
    });
});

export default app;

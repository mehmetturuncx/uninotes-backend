import { type Request,type Response,type NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
    namespace Express {
        interface Request {
            user?: {id: string; email: string; isAdmin?: boolean};
        }
    }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if(!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({message: 'Token not found.'});
        return;
    }

    const token = authHeader.split(' ')[1];
    if(!token) {
        res.status(401).json({message: "Unauthorized access, invalid format"});
        return;
    }

    try{
        const secret = process.env.JWT_SECRET || 'default_secret';
        const decoded = jwt.verify(token, secret) as unknown as {id:string; email: string; isAdmin?: boolean};
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({message:"Invalid token"});
    }
};
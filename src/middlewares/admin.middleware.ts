import { type Request,type Response,type NextFunction } from 'express';

export const adminMiddleware = (req:Request, res:Response, next:NextFunction): void => {
    const isAdmin = req.user?.isAdmin;

    if(isAdmin !== true) {
        res.status(403).json({message: "Forbidden: Admin access required."});
        return;
    }

    next();
}
import { Router } from "express";
import { registerSchema, loginSchema } from "../schemas/auth.schema";
import  jwt  from "jsonwebtoken";
import { db } from "../prisma/db";
import bcrypt from "bcryptjs";
import { registerLimiter, loginLimiter } from "../middlewares/rateLimiter";
import { AppError } from "../errors/AppError";

const router = Router();
 

router.post('/register',registerLimiter,async (req,res)=>{
    const validation = registerSchema.safeParse(req);

    if(!validation.success) {
        throw new AppError("Your informations are not correct.", 400);
    }

    const invCode = await db.orm.public.InviteCode.where({ code: req.body.inviteCode}).first();

    if(!invCode || invCode.isUsed == true) {
        throw new AppError("Invalid or used invitation code.", 400);
    }

    const password = validation.data.body.password;
    const email = validation.data.body.email;

    const isExist = await db.orm.public.User.where({email}).first();
    if(isExist){
        throw new AppError("This email is already used.", 400);
    }
 
    const hashedPassword = await bcrypt.hash(password,10);

    let isAdmin = false;
    const users = await db.orm.public.User.where({}).first();

    if(!users) {
        isAdmin = true;
    }

    const newUser = await db.orm.public.User.create({email,password: hashedPassword, isAdmin});

    await db.orm.public.InviteCode
        .where({id: invCode.id})
        .update({isUsed: true, usedById: newUser.id});
    
    const token = jwt.sign(
            {id: newUser.id,
            email: email,
            isAdmin},
            process.env.JWT_SECRET || "default_secret",
            {expiresIn: "1h"}
        );
    
    return res.status(201).json({
        token,
        user: {id: newUser.id,email,isAdmin}
    });
});

router.post('/login',loginLimiter,async (req,res)=>{
    const validation = loginSchema.safeParse(req);

    if(!validation.success) {
        throw new AppError("Your informations are not correct.", 400);
    }
    
    const email = validation.data.body.email;
    const password = validation.data.body.password;
    
    const user = await db.orm.public.User.where({email}).first();

    if(!user) {
        throw new AppError("Incorrect email or password!", 401);
    }

    const passCheck = await bcrypt.compare(password,user.password);
    if(!passCheck) {
        throw new AppError("Incorrect email or password!", 401);
    }
    const token = jwt.sign(
            {id: user.id,
            email: email,
            isAdmin: user.isAdmin},
            process.env.JWT_SECRET || "default_secret",
            {expiresIn: "1h"}
        );
    
        return res.status(200).json({
            message: "Login succesfull!",
            token,
            user: { id: user.id, email, isAdmin: user.isAdmin }
        });
});

export default router;
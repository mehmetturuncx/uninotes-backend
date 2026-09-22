import rateLimit from "express-rate-limit";

export const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    message: {message: "Çok fazla hatalı deneme yaptınız. Lütfen 15 dakika sonra tekrar deneyin."}
});

export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: {message: "Çok fazla hatalı deneme yaptınız. Lütfen 15 dakika sonra tekrar deneyin."}  
});

export const summarizeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: {message: "Çok fazla özetleme isteği yaptınız. Lütfen 10 dakika sonra tekrar deneyin."},
    keyGenerator: (req: any) => req.user?.id || req.ip,
    validate: { keyGeneratorIpFallback: false }
});
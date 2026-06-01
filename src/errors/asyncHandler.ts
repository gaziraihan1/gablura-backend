import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler and forwards any thrown error to next().
 *
 * Without asyncHandler:
 *   router.get("/me", async (req, res, next) => {
 *     try {
 *       const user = await getUser(req.user!.id);
 *       res.json(user);
 *     } catch (err) {
 *       next(err);  // ← easy to forget
 *     }
 *   });
 *
 * With asyncHandler:
 *   router.get("/me", asyncHandler(async (req, res) => {
 *     const user = await getUser(req.user!.id);
 *     res.json(user);
 *     // any throw → automatically forwarded to errorHandler
 *   }));
 */
export const asyncHandler = <T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
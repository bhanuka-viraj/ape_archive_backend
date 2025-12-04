import { Elysia } from "elysia";
import { forumController } from "../controllers/forum.controller";
import { answerController } from "../controllers/answer.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const forumRoutes = new Elysia({ prefix: "/forum" })
  .use(authMiddleware)
  .use(forumController)
  .group("/answers", (app) => app.use(answerController));

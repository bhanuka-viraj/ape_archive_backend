import { Elysia } from "elysia";
import { forumController } from "../controllers/forum.controller";
import { answerController } from "../controllers/answer.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const forumRoutes = (app: Elysia) =>
  app.group("/forum", (app) =>
    app
      .use(authMiddleware)
      .use(forumController)
      .group("/answers", (app) => app.use(answerController))
  );

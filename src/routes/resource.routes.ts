import { Elysia } from "elysia";
import { resourceController } from "../controllers/resource.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const resourceRoutes = (app: Elysia) =>
  app.group("/resources", (app) =>
    app.use(authMiddleware).use(resourceController)
  );

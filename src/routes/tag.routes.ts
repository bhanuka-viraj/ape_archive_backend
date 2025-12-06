import { Elysia } from "elysia";
import { tagController } from "../controllers/tag.controller";

export const tagRoutes = (app: Elysia) =>
  app.group("/tags", (app) => app.use(tagController));

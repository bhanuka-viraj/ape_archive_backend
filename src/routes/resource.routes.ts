import { Elysia } from "elysia";
import { resourceController } from "../controllers/resource.controller";

export const resourceRoutes = (app: Elysia) =>
  app.group("/resources", (app) => app.use(resourceController));

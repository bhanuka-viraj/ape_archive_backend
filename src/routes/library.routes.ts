import { Elysia } from "elysia";
import { libraryController } from "../controllers/library.controller";

export const libraryRoutes = (app: Elysia) =>
  app.group("/library", (app) => app.use(libraryController));

import { Elysia } from "elysia";
import { announcementController } from "../controllers/announcement.controller";

export const announcementRoutes = (app: Elysia) =>
  app.group("/announcements", (app) => app.use(announcementController));

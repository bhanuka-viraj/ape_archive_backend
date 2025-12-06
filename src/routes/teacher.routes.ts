import { Elysia } from "elysia";
import { teacherController } from "../controllers/teacher.controller";

export const teacherRoutes = (app: Elysia) =>
  app.group("/teachers", (app) => app.use(teacherController));

import { Elysia } from "elysia";
import { teacherController } from "../controllers/teacher.controller";

export const teacherRoutes = new Elysia({ prefix: "/teachers" }).use(
  teacherController
);

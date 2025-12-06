import { t } from "elysia";
import { Role } from "@prisma/client";

export const OnboardUserDTO = t.Object({
  role: t.Enum(Role),
  school: t.Optional(t.String()),
  batch: t.Optional(t.String()),
  bio: t.Optional(t.String()),
  qualifications: t.Optional(t.String()),
  whatsappNumber: t.Optional(t.String()),
  telegramUser: t.Optional(t.String()),
  interests: t.Optional(t.Array(t.String())),
  subjects: t.Optional(t.Array(t.String())),
});

export type OnboardUserBody = typeof OnboardUserDTO.static;

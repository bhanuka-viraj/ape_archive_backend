import { t } from "elysia";
import { Role } from "@prisma/client";

export const GoogleLoginDTO = t.Object({
  idToken: t.String({ minLength: 1, description: "Google ID Token" }),
});

export const RefreshTokenDTO = t.Object({
  refreshToken: t.String({ minLength: 1, description: "Refresh Token" }),
});

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

export type GoogleLoginBody = typeof GoogleLoginDTO.static;
export type RefreshTokenBody = typeof RefreshTokenDTO.static;
export type OnboardUserBody = typeof OnboardUserDTO.static;

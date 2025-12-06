import { Elysia, t } from "elysia";
import * as authController from "../controllers/auth.controller";
import { OnboardUserDTO } from "../dto/auth.dto";
import { isAuthenticated } from "../middlewares/auth.middleware";

export const authRoutes = (app: Elysia) =>
  app.group("/auth", (app) =>
    app
      .get("/google", authController.getGoogleAuthUrl, {
        detail: {
          summary: "Redirect to Google OAuth",
          description:
            "Redirects user to Google consent screen. This is the login entry point.",
          tags: ["Auth"],
        },
      })
      .get("/google/callback", authController.handleGoogleCallback, {
        query: t.Object({
          code: t.Optional(t.String()),
          error: t.Optional(t.String()),
          state: t.Optional(t.String()),
        }),
        detail: {
          summary: "Google OAuth Callback (Internal)",
          description:
            "Internal callback from Google. User is redirected here after authorizing. Then backend redirects to frontend with access token.",
          tags: ["Auth"],
        },
      })
      .use(isAuthenticated)
      .get("/me", authController.getMe, {
        detail: {
          summary: "Get Current User Profile",
          tags: ["Auth"],
          security: [{ BearerAuth: [] }],
        },
      })
      .post("/onboard", authController.onboardUser, {
        body: OnboardUserDTO,
        detail: {
          summary: "Onboard User - Set Role and Profile",
          tags: ["Auth"],
          security: [{ BearerAuth: [] }],
        },
      })
  );

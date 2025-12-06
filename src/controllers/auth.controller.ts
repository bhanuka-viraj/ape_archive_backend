import { Context } from "elysia";
import * as authService from "../services/auth.service";
import { env, isWhitelistedFrontend } from "../config/env";
import { UnauthorizedError, BadRequestError } from "../utils/error";
import { asyncHandler } from "../middlewares/async-handler.middleware";
import { log } from "../utils/logger";
import { errorResponse } from "../utils/response";
import { Role } from "@prisma/client";

/**
 * Step 1: Redirect to Google Authorization
 * Frontend calls this endpoint, backend redirects to Google consent screen
 */
export const getGoogleAuthUrl = asyncHandler(async ({ set }: any) => {
  log.info("Redirecting to Google OAuth");

  const authUrl = authService.getGoogleAuthUrl();

  set.status = 302;
  set.headers["Location"] = authUrl;

  return "";
});

/**
 * Step 2: Handle Google OAuth Callback (Internal)
 * Google redirects here after user authorizes
 * Backend exchanges code for tokens, creates/finds user
 * Then redirects frontend to success URL with access token in fragment
 */
export const handleGoogleCallback = asyncHandler(
  async ({ query, jwt, set }: any) => {
    const { code, error, state } = query;

    if (error) {
      log.warn("Google OAuth error", { error });
      set.status = 400;
      return errorResponse(`Google authorization failed: ${error}`, 400);
    }

    if (!code) {
      log.warn("Missing authorization code in callback");
      set.status = 400;
      return errorResponse("Missing authorization code", 400);
    }

    log.info("Processing Google OAuth callback");

    // Handle Google redirect - get/create user
    const { user } = await authService.handleGoogleRedirect(code);

    // Generate our own JWT access token
    const accessToken = await jwt.sign({
      id: user.id,
      role: user.role,
      type: "access",
    });

    log.info("User authenticated successfully", { userId: user.id });

    // Validate redirect URL against whitelist
    if (!isWhitelistedFrontend(env.FRONTEND_SUCCESS_URL)) {
      log.error("Frontend success URL not in whitelist", {
        url: env.FRONTEND_SUCCESS_URL,
        whitelist: env.FRONTEND_WHITELIST,
      });
      set.status = 500;
      return errorResponse("Server configuration error", 500);
    }

    // Redirect frontend to success URL with token in fragment
    const redirectUrl = new URL(env.FRONTEND_SUCCESS_URL);
    redirectUrl.hash = `accessToken=${accessToken}&userId=${user.id}&isOnboarded=${user.isOnboarded}`;

    set.status = 302;
    set.headers["Location"] = redirectUrl.toString();

    return "";
  }
);

/**
 * Get Current User Profile (/me)
 */
export const getMe = asyncHandler(async ({ user, set }: any) => {
  if (!user) {
    set.status = 401;
    throw new UnauthorizedError("Unauthorized");
  }

  log.debug("Fetching current user profile", { userId: user.id });

  const dbUser = await authService.getUserById(user.id);

  set.status = 200;
  return {
    success: true,
    data: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      imageUrl: dbUser.imageUrl,
      isOnboarded: dbUser.isOnboarded,
      createdAt: dbUser.createdAt,
    },
    message: "User profile retrieved successfully",
  };
});

/**
 * Onboard User - Update role and create profile
 */
export const onboardUser = asyncHandler(async ({ body, user, set }: any) => {
  if (!user) {
    set.status = 401;
    throw new UnauthorizedError("Unauthorized");
  }

  const {
    role,
    school,
    batch,
    bio,
    qualifications,
    whatsappNumber,
    telegramUser,
    interests,
    subjects,
  } = body;

  if (!role || (role !== Role.STUDENT && role !== Role.TEACHER)) {
    set.status = 400;
    throw new BadRequestError("Role must be STUDENT or TEACHER");
  }

  log.info("Onboarding user", { userId: user.id, role });

  const updatedUser = await authService.onboardUser(user.id, {
    role,
    school,
    batch,
    bio,
    qualifications,
    whatsappNumber,
    telegramUser,
    interests,
    subjects,
  });

  set.status = 200;
  return {
    success: true,
    data: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      isOnboarded: updatedUser.isOnboarded,
      imageUrl: updatedUser.imageUrl,
    },
    message: "User onboarded successfully",
  };
});

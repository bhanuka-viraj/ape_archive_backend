import { Context } from "elysia";
import * as authService from "../services/auth.service";
import { GoogleLoginBody, RefreshTokenBody } from "../dto/auth.dto";
import { env } from "../config/env";
import { UnauthorizedError, BadRequestError } from "../utils/error";
import { asyncHandler } from "../middlewares/async-handler.middleware";
import { log } from "../utils/logger";
import { Role } from "@prisma/client";

/**
 * Handle Google Login/Signup
 */
export const googleLogin = asyncHandler(async ({ body, jwt, set }: any) => {
  const { idToken } = body;

  log.info("Processing Google login request");

  // 1. Verify Google Token & Get/Create User
  const user = await authService.loginWithGoogle(idToken);

  // 2. Generate Tokens
  const accessToken = await jwt.sign({
    id: user.id,
    role: user.role,
    deviceId: "web", // Default or extract from headers
  });

  // Note: For refresh token, ideally use a separate secret/plugin or store in DB.
  // Here we sign with the same secret but you might want to differentiate.
  // Since the current setup has one jwt plugin, we'll use it.
  // Ideally, we should have a separate signer for refresh tokens.
  const refreshToken = await jwt.sign({
    id: user.id,
    type: "refresh",
  });

  log.info("Tokens generated successfully", { userId: user.id });

  return {
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        imageUrl: user.imageUrl,
        isOnboarded: user.isOnboarded,
      },
      accessToken,
      refreshToken,
    },
  };
});

/**
 * Get Current User (/me)
 */
export const getMe = asyncHandler(async ({ user }: any) => {
  log.debug("Fetching current user profile", { userId: user.userId });
  // user is attached by authMiddleware
  const dbUser = await authService.getUserById(user.userId);

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
  };
});

/**
 * Refresh Token
 */
export const refreshToken = asyncHandler(async ({ body, jwt }: any) => {
  const { refreshToken } = body;

  log.info("Processing refresh token request");

  const payload = await jwt.verify(refreshToken);
  if (!payload) {
    log.warn("Invalid refresh token provided");
    throw new UnauthorizedError("Invalid Refresh Token");
  }

  // Check if user still exists
  const user = await authService.getUserById(payload.id as string);

  // Generate new Access Token
  const newAccessToken = await jwt.sign({
    id: user.id,
    role: user.role,
    deviceId: "web",
  });

  log.info("Access token refreshed successfully", { userId: user.id });

  return {
    success: true,
    data: {
      accessToken: newAccessToken,
    },
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

  log.info("Onboarding user", { userId: user.userId, role });

  const updatedUser = await authService.onboardUser(user.userId, {
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
  };
});

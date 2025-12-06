import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { BadRequestError, UnauthorizedError } from "../utils/error";
import { Role } from "@prisma/client";
import { log } from "../utils/logger";

// Initialize Google OAuth2 Client
const googleClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

/**
 * Generate Google OAuth2 Authorization URL for redirect
 * Backend redirects user to Google consent screen
 */
export const getGoogleAuthUrl = () => {
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const authUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  log.info("Generated Google auth URL for redirect");
  return authUrl;
};

/**
 * Handle Google OAuth Callback (Internal - from Google)
 * Google redirects here after user authorizes
 * We exchange code for tokens and get/create user
 */
export const handleGoogleRedirect = async (code: string) => {
  try {
    log.info("Handling Google OAuth redirect");

    // Exchange code for tokens
    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token) {
      throw new Error("No ID token in response");
    }

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new Error("Invalid token payload");

    const { email, sub: googleId, name, picture } = payload;

    if (!email) {
      throw new BadRequestError("Email not found in Google token");
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      log.info("Creating new user from Google OAuth", { email });
      user = await prisma.user.create({
        data: {
          email,
          googleId,
          name: name || "User",
          imageUrl: picture,
          role: Role.GUEST,
          isOnboarded: false,
        },
      });
    } else if (!user.googleId) {
      log.info("Linking Google ID to existing user", { userId: user.id });
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, imageUrl: picture || user.imageUrl },
      });
    }

    log.info("User authenticated successfully", { userId: user.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        imageUrl: user.imageUrl,
        isOnboarded: user.isOnboarded,
      },
    };
  } catch (error) {
    log.error("Google redirect handling failed", error as Error);
    throw new BadRequestError("Failed to process Google authorization");
  }
};

/**
 * Get User by ID
 */
export const getUserById = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    log.warn("User not found", { userId });
    throw new UnauthorizedError("User not found");
  }
  return user;
};

/**
 * Onboard User - Set role and create profile
 */
export const onboardUser = async (
  userId: string,
  data: {
    role: Role;
    school?: string;
    batch?: string;
    bio?: string;
    qualifications?: string;
    whatsappNumber?: string;
    telegramUser?: string;
    interests?: string[]; // Category IDs or slugs
    subjects?: string[]; // Category IDs or slugs
  }
) => {
  if (data.role !== Role.STUDENT && data.role !== Role.TEACHER) {
    throw new BadRequestError("Invalid role. Must be STUDENT or TEACHER");
  }

  try {
    // Update user role and onboarded status
    let user = await prisma.user.update({
      where: { id: userId },
      data: {
        role: data.role,
        isOnboarded: true,
      },
    });

    // Create/Update profile based on role
    if (data.role === Role.STUDENT) {
      // Create or update student profile
      const studentProfile = await prisma.studentProfile.upsert({
        where: { userId },
        update: {
          school: data.school,
          batch: data.batch,
        },
        create: {
          userId,
          school: data.school,
          batch: data.batch,
        },
      });

      // Link interests if provided
      if (data.interests && data.interests.length > 0) {
        // Clear existing interests
        await prisma.studentProfile.update({
          where: { userId },
          data: {
            interests: {
              disconnect: await prisma.category
                .findMany({
                  where: { studentProfiles: { some: { userId } } },
                })
                .then((cats) => cats.map((c) => ({ id: c.id }))),
            },
          },
        });

        // Add new interests
        await prisma.studentProfile.update({
          where: { userId },
          data: {
            interests: {
              connect: data.interests.map((cat) => ({ slug: cat })),
            },
          },
        });
      }

      log.info("Student profile created/updated", { userId });
    } else if (data.role === Role.TEACHER) {
      // Create or update teacher profile
      const teacherProfile = await prisma.teacherProfile.upsert({
        where: { userId },
        update: {
          bio: data.bio,
          qualifications: data.qualifications,
          whatsappNumber: data.whatsappNumber,
          telegramUser: data.telegramUser,
        },
        create: {
          userId,
          bio: data.bio,
          qualifications: data.qualifications,
          whatsappNumber: data.whatsappNumber,
          telegramUser: data.telegramUser,
          isAvailable: true,
        },
      });

      // Link subjects if provided
      if (data.subjects && data.subjects.length > 0) {
        // Clear existing subjects
        await prisma.teacherProfile.update({
          where: { userId },
          data: {
            subjects: {
              disconnect: await prisma.category
                .findMany({
                  where: { teacherProfiles: { some: { userId } } },
                })
                .then((cats) => cats.map((c) => ({ id: c.id }))),
            },
          },
        });

        // Add new subjects
        await prisma.teacherProfile.update({
          where: { userId },
          data: {
            subjects: {
              connect: data.subjects.map((cat) => ({ slug: cat })),
            },
          },
        });
      }

      log.info("Teacher profile created/updated", { userId });
    }

    return user;
  } catch (error) {
    log.error("Onboarding failed", error as Error);
    throw new BadRequestError("Failed to onboard user");
  }
};

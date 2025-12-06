export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL:
    process.env.DATABASE_URL || "postgresql://localhost/ape_archive",
  JWT_SECRET: process.env.JWT_SECRET || "supersecret",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI:
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/v1/auth/google/callback",
  FRONTEND_WHITELIST: (
    process.env.FRONTEND_WHITELIST?.split(",") || ["http://localhost:3001"]
  ).map((url) => url.trim()),
  FRONTEND_SUCCESS_URL:
    process.env.FRONTEND_SUCCESS_URL || "http://localhost:3001/dashboard",
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
  ROOT_FOLDER_ID: process.env.ROOT_FOLDER_ID || "",
  UPLOAD_FOLDER_ID: process.env.UPLOAD_FOLDER_ID || "",
};

/**
 * Utility function to validate if a URL is in the whitelist
 */
export const isWhitelistedFrontend = (url: string): boolean => {
  try {
    const urlOrigin = new URL(url).origin;
    return env.FRONTEND_WHITELIST.some((whitelisted) => {
      const whitelistedOrigin = new URL(whitelisted).origin;
      return urlOrigin === whitelistedOrigin;
    });
  } catch {
    return false;
  }
};

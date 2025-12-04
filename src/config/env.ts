export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL:
    process.env.DATABASE_URL || "postgresql://localhost/ape_archive",
  JWT_SECRET: process.env.JWT_SECRET || "supersecret",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "supersecret_refresh",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
  ROOT_FOLDER_ID: process.env.ROOT_FOLDER_ID || "",
};

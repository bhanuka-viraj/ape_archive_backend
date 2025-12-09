import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

// Load environment variables
config();

const prisma = new PrismaClient();

// Validate required environment variables
function validateEnv() {
  const requiredEnvs = {
    UPLOAD_FOLDER_ID: "Google Drive folder ID for storing uploaded files",
    GOOGLE_CLIENT_ID: "Google OAuth2 Client ID",
    GOOGLE_CLIENT_SECRET: "Google OAuth2 Client Secret",
    GOOGLE_REFRESH_TOKEN: "Google OAuth2 Refresh Token for authentication",
  };

  const missing: string[] = [];

  for (const [key, description] of Object.entries(requiredEnvs)) {
    if (!process.env[key]) {
      missing.push(`  ❌ ${key}: ${description}`);
    }
  }

  if (missing.length > 0) {
    console.error(
      "\n❌ SEEDING FAILED - Missing required environment variables:\n"
    );
    console.error(missing.join("\n"));
    console.error("\n📝 Please configure these variables in your .env file.\n");
    process.exit(1);
  }
}

async function main() {
  console.log("🌱 Seeding database...\n");

  // Validate environment
  validateEnv();

  const uploadFolderId = process.env.UPLOAD_FOLDER_ID!;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;
  const storageName = `Google Drive Storage (${uploadFolderId.substring(
    0,
    8
  )}...)`;

  console.log(`📍 Using UPLOAD_FOLDER_ID: ${uploadFolderId}`);
  console.log(`🔑 Refresh Token: ${refreshToken.substring(0, 20)}...`);
  console.log(`📝 Storage Name: ${storageName}\n`);

  // Create default storage node with refresh token for Google Drive auth
  const defaultStorage = await prisma.storageNode.upsert({
    where: { id: 1 },
    update: {
      name: storageName,
      email: "bhanukaviraj22@gmail.com",
      refreshToken: refreshToken,
      isActive: true,
    },
    create: {
      id: 1,
      name: storageName,
      email: "bhanukaviraj22@gmail.com",
      refreshToken: refreshToken,
      totalSpace: BigInt(0),
      usedSpace: BigInt(0),
      isActive: true,
    },
  });

  console.log("✅ Created default storage node:", {
    id: defaultStorage.id,
    name: defaultStorage.name,
    email: defaultStorage.email,
    isActive: defaultStorage.isActive,
    hasRefreshToken: !!defaultStorage.refreshToken,
  });

  // Create system-sync user if it doesn't exist
  const systemUser = await prisma.user.upsert({
    where: { id: "system-sync" },
    update: {},
    create: {
      id: "system-sync",
      email: "system-sync@apeArchive.com",
      name: "System Bot",
      role: "ADMIN",
      isOnboarded: true,
    },
  });

  console.log("✅ Created system user:", {
    id: systemUser.id,
    name: systemUser.name,
    role: systemUser.role,
  });

  console.log("\n🎉 Seeding complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

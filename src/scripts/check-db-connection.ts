
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function main() {
  console.log("Checking database connection...");
  try {
    await prisma.$connect();
    console.log("✅ Connected to database successfully.");
    
    // Try a simple query
    const count = await prisma.user.count();
    console.log(`User count: ${count}`);
    
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

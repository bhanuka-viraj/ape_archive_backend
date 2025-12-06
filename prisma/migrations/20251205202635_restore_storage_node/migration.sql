-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "storageNodeId" INTEGER;

-- CreateTable
CREATE TABLE "StorageNode" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "totalSpace" BIGINT NOT NULL DEFAULT 0,
    "usedSpace" BIGINT NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageNode_name_key" ON "StorageNode"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StorageNode_email_key" ON "StorageNode"("email");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_storageNodeId_fkey" FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

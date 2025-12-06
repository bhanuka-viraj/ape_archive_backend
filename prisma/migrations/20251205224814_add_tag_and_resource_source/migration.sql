-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "ResourceSource" AS ENUM ('SYSTEM', 'USER');

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "source" "ResourceSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "source" "TagSource" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "Resource_source_idx" ON "Resource"("source");

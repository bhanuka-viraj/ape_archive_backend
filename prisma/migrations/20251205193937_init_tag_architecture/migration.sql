/*
  Warnings:

  - You are about to drop the column `storageNodeId` on the `Resource` table. All the data in the column will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StorageNode` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_CategoryToQuestion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_CategoryToResource` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_CategoryToStudentProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_CategoryToTeacherProfile` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_storageNodeId_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToQuestion" DROP CONSTRAINT "_CategoryToQuestion_A_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToQuestion" DROP CONSTRAINT "_CategoryToQuestion_B_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToResource" DROP CONSTRAINT "_CategoryToResource_A_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToResource" DROP CONSTRAINT "_CategoryToResource_B_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToStudentProfile" DROP CONSTRAINT "_CategoryToStudentProfile_A_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToStudentProfile" DROP CONSTRAINT "_CategoryToStudentProfile_B_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToTeacherProfile" DROP CONSTRAINT "_CategoryToTeacherProfile_A_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryToTeacherProfile" DROP CONSTRAINT "_CategoryToTeacherProfile_B_fkey";

-- AlterTable
ALTER TABLE "Resource" DROP COLUMN "storageNodeId";

-- DropTable
DROP TABLE "Category";

-- DropTable
DROP TABLE "StorageNode";

-- DropTable
DROP TABLE "_CategoryToQuestion";

-- DropTable
DROP TABLE "_CategoryToResource";

-- DropTable
DROP TABLE "_CategoryToStudentProfile";

-- DropTable
DROP TABLE "_CategoryToTeacherProfile";

-- DropEnum
DROP TYPE "CategoryType";

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "group" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_StudentProfileToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StudentProfileToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_QuestionToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QuestionToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TagToTeacherProfile" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TagToTeacherProfile_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourceToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "_StudentProfileToTag_B_index" ON "_StudentProfileToTag"("B");

-- CreateIndex
CREATE INDEX "_QuestionToTag_B_index" ON "_QuestionToTag"("B");

-- CreateIndex
CREATE INDEX "_TagToTeacherProfile_B_index" ON "_TagToTeacherProfile"("B");

-- CreateIndex
CREATE INDEX "_ResourceToTag_B_index" ON "_ResourceToTag"("B");

-- CreateIndex
CREATE INDEX "Resource_title_idx" ON "Resource"("title");

-- CreateIndex
CREATE INDEX "Resource_status_idx" ON "Resource"("status");

-- AddForeignKey
ALTER TABLE "_StudentProfileToTag" ADD CONSTRAINT "_StudentProfileToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StudentProfileToTag" ADD CONSTRAINT "_StudentProfileToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuestionToTag" ADD CONSTRAINT "_QuestionToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuestionToTag" ADD CONSTRAINT "_QuestionToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTeacherProfile" ADD CONSTRAINT "_TagToTeacherProfile_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTeacherProfile" ADD CONSTRAINT "_TagToTeacherProfile_B_fkey" FOREIGN KEY ("B") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceToTag" ADD CONSTRAINT "_ResourceToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceToTag" ADD CONSTRAINT "_ResourceToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

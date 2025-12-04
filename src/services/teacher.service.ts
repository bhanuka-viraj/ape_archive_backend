import { prisma } from "../config/database";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";

export const teacherService = {
  /**
   * Get all teachers with optional filtering by subject
   */
  async getTeachers(
    page: number = 1,
    limit: number = 10,
    subjectSlug?: string
  ) {
    try {
      const skip = (page - 1) * limit;

      const where = subjectSlug
        ? {
            user: { role: "TEACHER" },
            profile: {
              teacherProfiles: {
                some: {
                  subjects: {
                    some: { slug: subjectSlug },
                  },
                },
              },
            },
          }
        : { user: { role: "TEACHER" } };

      const [teachers, total] = await Promise.all([
        prisma.teacherProfile.findMany({
          where: subjectSlug
            ? {
                subjects: {
                  some: { slug: subjectSlug },
                },
              }
            : {},
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                imageUrl: true,
                role: true,
              },
            },
            subjects: true,
          },
          orderBy: { isAvailable: "desc" },
        }),
        prisma.teacherProfile.count(
          subjectSlug
            ? {
                where: {
                  subjects: {
                    some: { slug: subjectSlug },
                  },
                },
              }
            : undefined
        ),
      ]);

      return {
        data: teachers.map((t) => ({
          id: t.id,
          userId: t.userId,
          name: t.user.name,
          email: t.user.email,
          imageUrl: t.user.imageUrl,
          bio: t.bio,
          qualifications: t.qualifications,
          whatsappNumber: t.whatsappNumber,
          telegramUser: t.telegramUser,
          isAvailable: t.isAvailable,
          subjects: t.subjects.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
          })),
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      log.error("Error fetching teachers", error as Error);
      throw new AppError("Failed to fetch teachers", 500);
    }
  },

  /**
   * Get teacher by ID
   */
  async getTeacherById(teacherId: string) {
    try {
      const teacher = await prisma.teacherProfile.findUnique({
        where: { id: teacherId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              imageUrl: true,
              role: true,
            },
          },
          subjects: true,
        },
      });

      if (!teacher) {
        throw new AppError("Teacher not found", 404);
      }

      return {
        id: teacher.id,
        userId: teacher.userId,
        name: teacher.user.name,
        email: teacher.user.email,
        imageUrl: teacher.user.imageUrl,
        bio: teacher.bio,
        qualifications: teacher.qualifications,
        whatsappNumber: teacher.whatsappNumber,
        telegramUser: teacher.telegramUser,
        isAvailable: teacher.isAvailable,
        subjects: teacher.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
        })),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("Error fetching teacher", error as Error);
      throw new AppError("Failed to fetch teacher", 500);
    }
  },

  /**
   * Get teachers by subject
   */
  async getTeachersBySubject(
    subjectSlug: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const skip = (page - 1) * limit;

      const [teachers, total] = await Promise.all([
        prisma.teacherProfile.findMany({
          where: {
            subjects: {
              some: { slug: subjectSlug },
            },
          },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                imageUrl: true,
                role: true,
              },
            },
            subjects: true,
          },
          orderBy: { isAvailable: "desc" },
        }),
        prisma.teacherProfile.count({
          where: {
            subjects: {
              some: { slug: subjectSlug },
            },
          },
        }),
      ]);

      return {
        data: teachers.map((t) => ({
          id: t.id,
          userId: t.userId,
          name: t.user.name,
          email: t.user.email,
          imageUrl: t.user.imageUrl,
          bio: t.bio,
          qualifications: t.qualifications,
          whatsappNumber: t.whatsappNumber,
          telegramUser: t.telegramUser,
          isAvailable: t.isAvailable,
          subjects: t.subjects.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
          })),
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      log.error("Error fetching teachers by subject", error as Error);
      throw new AppError("Failed to fetch teachers", 500);
    }
  },
};

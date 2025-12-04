import { prisma } from "../config/database";
import { Role, CategoryType, Prisma } from "@prisma/client";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { categoryService } from "./category.service";

interface CreateQuestionInput {
  title: string;
  content: string;
  authorId: string;
  categoryTags: string[]; // Category slugs
}

interface CreateAnswerInput {
  content: string;
  questionId: string;
  authorId: string;
}

export const forumService = {
  /**
   * Create a new question
   */
  async createQuestion(input: CreateQuestionInput) {
    try {
      // Generate slug from title
      const slug =
        input.title
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]/g, "")
          .slice(0, 50) + `-${Date.now()}`;

      // Get or create category tags
      const categoryPromises = input.categoryTags.map(async (tagName) => {
        let category = await prisma.category.findUnique({
          where: { slug: tagName },
        });

        if (!category) {
          category = await categoryService.getOrCreateCategory(
            tagName,
            CategoryType.TAG
          );
        }

        return category;
      });

      const categories = await Promise.all(categoryPromises);

      const question = await prisma.question.create({
        data: {
          title: input.title,
          content: input.content,
          slug,
          authorId: input.authorId,
          categories: {
            connect: categories.map((cat) => ({ id: cat.id })),
          },
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              role: true,
              imageUrl: true,
            },
          },
          categories: true,
          answers: true,
        },
      });

      log.info("Question created", {
        questionId: question.id,
        authorId: input.authorId,
      });
      return question;
    } catch (error) {
      log.error("Error creating question", error as Error);
      throw new AppError("Failed to create question", 500);
    }
  },

  /**
   * Get question by ID with answers sorted by role and upvotes
   */
  async getQuestionById(id: string) {
    try {
      const question = await prisma.question.findUnique({
        where: { id },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              role: true,
              imageUrl: true,
            },
          },
          categories: true,
          answers: {
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  role: true,
                  imageUrl: true,
                },
              },
              votes: true,
            },
            orderBy: [
              { author: { role: "desc" } }, // TEACHER > STUDENT > GUEST (enum order)
              { isAccepted: "desc" },
              { upvotes: "desc" },
            ],
          },
        },
      });

      if (!question) {
        throw new AppError("Question not found", 404);
      }

      // Increment views
      await prisma.question.update({
        where: { id },
        data: { views: { increment: 1 } },
      });

      return question;
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("Error fetching question", error as Error);
      throw new AppError("Failed to fetch question", 500);
    }
  },

  /**
   * Get all questions with pagination and filtering
   */
  async getQuestions(
    page: number = 1,
    limit: number = 10,
    search?: string,
    categorySlug?: string,
    solved?: boolean
  ) {
    try {
      const skip = (page - 1) * limit;

      const where: Prisma.QuestionWhereInput = {};

      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
        ];
      }

      if (categorySlug) {
        where.categories = {
          some: { slug: categorySlug },
        };
      }

      if (solved !== undefined) {
        where.isSolved = solved;
      }

      const [questions, total] = await Promise.all([
        prisma.question.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                role: true,
                imageUrl: true,
              },
            },
            categories: true,
            answers: {
              select: { id: true },
            },
          },
        }),
        prisma.question.count({ where }),
      ]);

      return {
        data: questions,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      log.error("Error fetching questions", error as Error);
      throw new AppError("Failed to fetch questions", 500);
    }
  },

  /**
   * Create an answer to a question
   */
  async createAnswer(input: CreateAnswerInput) {
    try {
      // Verify question exists
      const question = await prisma.question.findUnique({
        where: { id: input.questionId },
      });

      if (!question) {
        throw new AppError("Question not found", 404);
      }

      const answer = await prisma.answer.create({
        data: {
          content: input.content,
          questionId: input.questionId,
          authorId: input.authorId,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              role: true,
              imageUrl: true,
            },
          },
          votes: true,
        },
      });

      log.info("Answer created", {
        answerId: answer.id,
        questionId: input.questionId,
      });
      return answer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("Error creating answer", error as Error);
      throw new AppError("Failed to create answer", 500);
    }
  },

  /**
   * Vote on an answer (upvote or toggle)
   */
  async voteAnswer(answerId: string, userId: string) {
    try {
      // Check if vote already exists
      const existingVote = await prisma.vote.findUnique({
        where: {
          userId_answerId: {
            userId,
            answerId,
          },
        },
      });

      if (existingVote) {
        // Remove vote (toggle)
        await prisma.vote.delete({
          where: {
            userId_answerId: {
              userId,
              answerId,
            },
          },
        });

        // Decrement upvotes
        await prisma.answer.update({
          where: { id: answerId },
          data: { upvotes: { decrement: 1 } },
        });

        log.debug("Vote removed", { answerId, userId });
        return { voted: false };
      } else {
        // Create new vote
        await prisma.vote.create({
          data: {
            userId,
            answerId,
          },
        });

        // Increment upvotes
        await prisma.answer.update({
          where: { id: answerId },
          data: { upvotes: { increment: 1 } },
        });

        log.debug("Vote added", { answerId, userId });
        return { voted: true };
      }
    } catch (error) {
      log.error("Error voting on answer", error as Error);
      throw new AppError("Failed to vote on answer", 500);
    }
  },

  /**
   * Mark an answer as accepted (only question author can do this)
   */
  async markAnswerAsAccepted(
    answerId: string,
    questionId: string,
    userId: string
  ) {
    try {
      // Verify user is question author
      const question = await prisma.question.findUnique({
        where: { id: questionId },
      });

      if (!question) {
        throw new AppError("Question not found", 404);
      }

      if (question.authorId !== userId) {
        throw new AppError(
          "Only question author can mark answer as accepted",
          403
        );
      }

      // Mark answer as accepted
      const answer = await prisma.answer.update({
        where: { id: answerId },
        data: { isAccepted: true },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              role: true,
              imageUrl: true,
            },
          },
        },
      });

      // Mark question as solved
      await prisma.question.update({
        where: { id: questionId },
        data: { isSolved: true },
      });

      log.info("Answer marked as accepted", { answerId, questionId });
      return answer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("Error marking answer as accepted", error as Error);
      throw new AppError("Failed to mark answer as accepted", 500);
    }
  },
};

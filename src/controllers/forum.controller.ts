import { Elysia, t } from "elysia";
import { forumService } from "../services/forum.service";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../utils/error";
import { log } from "../utils/logger";

export const forumController = new Elysia()
  // Questions endpoints
  .get(
    "/",
    async ({ query }) => {
      try {
        const questions = await forumService.getQuestions(
          query.page ? Number(query.page) : 1,
          query.limit ? Number(query.limit) : 10,
          query.search,
          query.category,
          query.solved !== undefined ? query.solved === "true" : undefined
        );
        return successResponse(questions, "Questions fetched successfully");
      } catch (error) {
        log.error("Error fetching questions", error as Error);
        const message =
          error instanceof AppError
            ? error.message
            : "Failed to fetch questions";
        return errorResponse(message, 500);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        category: t.Optional(t.String()),
        solved: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/",
    async ({ body, user, set }: any) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const question = await forumService.createQuestion({
          title: body.title,
          content: body.content,
          authorId: user.userId,
          categoryTags: body.categoryTags || [],
        });

        set.status = 201;
        return successResponse(question, "Question created successfully");
      } catch (error) {
        log.error("Error creating question", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError
            ? error.message
            : "Failed to create question";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 5 }),
        content: t.String({ minLength: 10 }),
        categoryTags: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .get("/:id", async ({ params, set }) => {
    try {
      const question = await forumService.getQuestionById(params.id);
      return successResponse(question, "Question fetched successfully");
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        set.status = 404;
        return errorResponse("Question not found", 404);
      }
      log.error("Error fetching question", error as Error);
      set.status = 500;
      return errorResponse("Failed to fetch question", 500);
    }
  })
  // Answers endpoints - nested under questions
  .post(
    "/:id/answers",
    async ({ params, body, user, set }: any) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const answer = await forumService.createAnswer({
          content: body.content,
          questionId: params.id,
          authorId: user.userId,
        });

        set.status = 201;
        return successResponse(answer, "Answer created successfully");
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) {
          set.status = 404;
          return errorResponse("Question not found", 404);
        }
        log.error("Error creating answer", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError ? error.message : "Failed to create answer";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        content: t.String({ minLength: 10 }),
      }),
    }
  )
  // Mark answer as accepted - using a different endpoint structure
  .patch(
    "/:id/answers/:answerId/accept",
    async ({ params, user, set }: any) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const answer = await forumService.markAnswerAsAccepted(
          params.answerId,
          params.id,
          user.userId
        );
        return successResponse(answer, "Answer marked as accepted");
      } catch (error) {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return errorResponse(error.message, error.statusCode);
        }
        log.error("Error marking answer as accepted", error as Error);
        set.status = 500;
        return errorResponse("Failed to mark answer as accepted", 500);
      }
    }
  );

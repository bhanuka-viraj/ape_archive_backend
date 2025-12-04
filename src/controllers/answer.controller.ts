import { Elysia, t } from "elysia";
import { forumService } from "../services/forum.service";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../utils/error";
import { log } from "../utils/logger";

export const answerController = new Elysia()
  // Vote on answer
  .post("/:id/vote", async ({ params, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const result = await forumService.voteAnswer(params.id, user.userId);
      return successResponse(
        result,
        `Answer ${result.voted ? "upvoted" : "unvoted"}`
      );
    } catch (error) {
      log.error("Error voting on answer", error as Error);
      set.status = 500;
      const message =
        error instanceof AppError ? error.message : "Failed to vote";
      return errorResponse(message, 500);
    }
  });

/**
 * Standard Success Response Format
 * Used for all successful API responses
 */
export const successResponse = <T = any>(
  data: T,
  message: string = "Success"
) => {
  return {
    success: true,
    message,
    data,
  };
};

/**
 * Standard Error Response Format
 * Used for all error API responses
 */
export const errorResponse = (
  message: string = "Error",
  statusCode: number = 500,
  error?: any
) => {
  return {
    success: false,
    message,
    statusCode,
    ...(error && { error }),
  };
};

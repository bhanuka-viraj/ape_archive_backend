import { swagger } from "@elysiajs/swagger";

export const swaggerPlugin = swagger({
  provider: "scalar",
  scalarConfig: {
    theme: "none",
  },
  documentation: {
    info: {
      title: "APE Archive API",
      version: "1.0.0",
      description: "API Documentation for APE Archive",
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your JWT token (access token from Google OAuth callback)",
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
});

import { swagger } from "@elysiajs/swagger";

export const swaggerPlugin = swagger({
  documentation: {
    info: {
      title: "ElysiaJS API",
      version: "1.0.0",
      description: "API Documentation for ElysiaJS Sample Project",
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your JWT token (access token from Google OAuth callback)",
    provider: 'scalar',
    documentation: {
        info: {
            title: "ElysiaJS API",
            version: "1.0.0",
            description: "API Documentation for ElysiaJS Sample Project",
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
    scalarConfig: {
        theme: 'mars',
    }
});

import { Request, Response, NextFunction } from "express";
import { ZodError, ZodObject } from "zod";

type SchemaBundle = {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
};

type ValidationError = {
  path: string;
  message: string;
};

export const validate =
  (schemas: SchemaBundle) =>
  (req: Request, res: Response, next: NextFunction) => {
    const errors: ValidationError[] = [];

    const validatePart = <T>(
      schema: ZodObject | undefined,
      data: unknown,
      assign: (parsed: T) => void,
    ) => {
      if (!schema) return;

      const result = schema.safeParse(data);

      if (!result.success) {
        const formatted = formatZodErrors(result.error);
        errors.push(...formatted);
      } else {
        assign(result.data as T);
      }
    };

    validatePart<typeof req.body>(schemas.body, req.body, (data) => {
      req.body = data;
    });

    validatePart<typeof req.query>(schemas.query, req.query, (data) => {
      req.query = data as Request["query"];
    });

    validatePart<typeof req.params>(schemas.params, req.params, (data) => {
      req.params = data as Request["params"];
    });

    if (errors.length > 0) {
      return res.status(400).json({
        error: "validation_error",
        details: errors,
      });
    }

    next();
  };

function formatZodErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

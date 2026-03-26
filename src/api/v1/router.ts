import { Router, Request, Response, NextFunction } from "express";
import streamsRouter from "./streams";

const v1Router = Router();

// Global middleware for v1 APIs
v1Router.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-API-Version", "v1");
    res.setHeader("Deprecation", "false");
    next();
});

// Mount existing streams logic
v1Router.use("/streams", streamsRouter);

export default v1Router;

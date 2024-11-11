import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { jsonContent } from "@/common/networking.ts";

import {
    CompletionRequest,
    CompletionRespChoice,
    CompletionResponse,
} from "./types/completions.ts";
import checkModelMiddleware from "../middleware/checkModelMiddleware.ts";

const router = new Hono();

const completionsRoute = describeRoute({
    responses: {
        200: jsonContent(CompletionResponse, "Response to completions"),
    },
});

router.post(
    "/v1/completions",
    completionsRoute,
    checkModelMiddleware,
    zValidator("json", CompletionRequest),
    async (c) => {
        const params = c.req.valid("json");
        const result = await c.var.model.generate(params.prompt, params);
        const completionChoice = await CompletionRespChoice.parseAsync({
            text: result,
            index: 0,
        });

        return c.json(
            await CompletionResponse.parseAsync({
                choices: [completionChoice],
                model: "test",
            }),
        );
    },
);

export default router;

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import {
    ModelCard,
    ModelList,
    ModelLoadRequest,
} from "@/api/core/types/model.ts";
import { AuthKeyPermission } from "@/common/auth.ts";
import { ModelConfig } from "@/common/configModels.ts";
import { config } from "@/common/config.ts";
import { logger } from "@/common/logging.ts";
import * as modelContainer from "@/common/modelContainer.ts";
import { jsonContent } from "@/common/networking.ts";

import authMiddleware from "../middleware/authMiddleware.ts";
import checkModelMiddleware from "../middleware/checkModelMiddleware.ts";
import { HTTPException } from "hono/http-exception";
import {
    TemplateList,
    TemplateSwitchRequest,
} from "@/api/core/types/template.ts";
import { PromptTemplate } from "@/common/templating.ts";

const router = new Hono();

const modelsRoute = describeRoute({
    responses: {
        200: jsonContent(ModelList, "List of models in directory"),
    },
});

router.on(
    "GET",
    ["/v1/models", "/v1/model/list"],
    modelsRoute,
    authMiddleware(AuthKeyPermission.API),
    async (c) => {
        const modelCards: ModelCard[] = [];
        for await (const file of Deno.readDir(config.model.model_dir)) {
            if (!file.name.endsWith(".gguf")) {
                continue;
            }

            const modelCard = await ModelCard.parseAsync({
                id: file.name.replace(".gguf", ""),
            });

            modelCards.push(modelCard);
        }

        const modelList = await ModelList.parseAsync({
            data: modelCards,
        });

        return c.json(modelList);
    },
);

const currentModelRoute = describeRoute({
    responses: {
        200: jsonContent(
            ModelCard,
            "The currently loaded model (if it exists)",
        ),
    },
});

router.get(
    "/v1/model",
    currentModelRoute,
    authMiddleware(AuthKeyPermission.API),
    checkModelMiddleware,
    async (c) => {
        const modelCard = await ModelCard.parseAsync({
            id: c.var.model.path.base,
        });

        return c.json(modelCard);
    },
);

const loadModelRoute = describeRoute({
    responses: {
        200: {
            description: "Model successfully loaded",
        },
    },
});

// TODO: Make this a streaming response if necessary
router.post(
    "/v1/model/load",
    loadModelRoute,
    authMiddleware(AuthKeyPermission.Admin),
    zValidator("json", ModelLoadRequest),
    async (c) => {
        const params = c.req.valid("json");
        const loadParams = await ModelConfig.parseAsync({
            ...params,
            model_dir: config.model.model_dir,
        });

        // Makes sure the event doesn't fire multiple times
        let finished = false;

        // Abort handler
        const progressAbort = new AbortController();
        c.req.raw.signal.addEventListener("abort", () => {
            if (!finished) {
                progressAbort.abort();
            }
        });

        const progressCallback = (_progress: number): boolean => {
            if (progressAbort.signal.aborted) {
                logger.error("Load request cancelled");
                return false;
            }

            return true;
        };

        // Load the model and re-raise errors
        try {
            await modelContainer.loadModel(loadParams, progressCallback);
        } catch (error) {
            if (error instanceof Error) {
                throw new HTTPException(422, error);
            }
        }

        finished = true;

        c.status(200);
        return c.body(null);
    },
);

const unloadRoute = describeRoute({
    responses: {
        200: {
            description: "Model successfully unloaded",
        },
    },
});

router.post(
    "/v1/model/unload",
    unloadRoute,
    authMiddleware(AuthKeyPermission.Admin),
    checkModelMiddleware,
    async (c) => {
        await modelContainer.unloadModel(true);

        c.status(200);
        return c.body(null);
    },
);

const templatesRoute = describeRoute({
    responses: {
        200: jsonContent(TemplateList, "List of prompt templates"),
    },
});

router.on(
    "GET",
    ["/v1/templates", "/v1/template/list"],
    templatesRoute,
    authMiddleware(AuthKeyPermission.API),
    async (c) => {
        const templates: string[] = [];
        for await (const file of Deno.readDir("templates")) {
            if (!file.name.endsWith(".jinja")) {
                continue;
            }

            templates.push(file.name.replace(".jinja", ""));
        }

        const templateList = await TemplateList.parseAsync({
            data: templates,
        });

        return c.json(templateList);
    },
);

const templateSwitchRoute = describeRoute({
    responses: {
        200: {
            description: "Prompt template switched",
        },
    },
});

router.get(
    "/v1/template/switch",
    templateSwitchRoute,
    authMiddleware(AuthKeyPermission.API),
    checkModelMiddleware,
    zValidator("json", TemplateSwitchRequest),
    async (c) => {
        const params = c.req.valid("json");

        const templatePath = `templates/${params.prompt_template_name}`;
        c.var.model.promptTemplate = await PromptTemplate.fromFile(
            templatePath,
        );
    },
);

export default router;

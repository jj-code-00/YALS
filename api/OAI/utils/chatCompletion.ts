import { HonoRequest } from "hono";
import { SSEStreamingApi } from "hono/streaming";
import {
    createUsageStats,
    staticGenerate,
} from "@/api/OAI/utils/generation.ts";
import { FinishChunk, GenerationChunk, Model } from "@/bindings/bindings.ts";
import { logger } from "@/common/logging.ts";
import { PromptTemplate } from "@/common/templating.ts";

import {
    ChatCompletionMessage,
    ChatCompletionMessagePart,
    ChatCompletionRequest,
    ChatCompletionRespChoice,
    ChatCompletionResponse,
    ChatCompletionStreamChoice,
    ChatCompletionStreamChunk,
} from "../types/chatCompletions.ts";

async function createResponse(chunk: FinishChunk, modelName: string) {
    const message = await ChatCompletionMessage.parseAsync({
        role: "assistant",
        content: chunk.text,
    });

    const choice = await ChatCompletionRespChoice.parseAsync({
        message: message,
    });

    const usage = await createUsageStats(chunk);

    const response = await ChatCompletionResponse.parseAsync({
        choices: [choice],
        model: modelName,
        usage,
    });

    return response;
}

async function createStreamChunk(
    chunk: GenerationChunk,
    modelName: string,
    cmplId: string,
) {
    const message = await ChatCompletionMessage.parseAsync({
        role: "assistant",
        content: chunk.text,
    });

    const choice = await ChatCompletionStreamChoice.parseAsync({
        delta: message,
    });

    const response = await ChatCompletionStreamChunk.parseAsync({
        id: cmplId,
        choices: [choice],
        model: modelName,
    });

    return response;
}

async function createUsageChunk(
    chunk: FinishChunk,
    modelName: string,
    cmplId: string,
) {
    const response = ChatCompletionStreamChunk.parseAsync({
        id: cmplId,
        model: modelName,
        usage: await createUsageStats(chunk),
    });

    return response;
}

function applyChatTemplate(
    model: Model,
    promptTemplate: PromptTemplate,
    params: ChatCompletionRequest,
): string {
    params.messages.forEach((message) => {
        if (Array.isArray(message.content)) {
            const messageParts = message.content as ChatCompletionMessagePart[];
            message.content = messageParts.find((part) =>
                part.type === "text"
            )?.text ?? "";
        }
    });

    const prompt = promptTemplate.render({
        ...params.template_vars,
        messages: params.messages,
        bos_token: params.add_bos_token ? model.tokenizer.bosToken.piece : "",
        eos_token: params.ban_eos_token ? "" : model.tokenizer.eosToken.piece,
        add_generation_prompt: params.add_generation_prompt,
    });

    return prompt;
}

// TODO: Possibly rewrite this to unify with completions
export async function streamChatCompletion(
    req: HonoRequest,
    stream: SSEStreamingApi,
    model: Model,
    promptTemplate: PromptTemplate,
    params: ChatCompletionRequest,
) {
    const cmplId = `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
    const abortController = new AbortController();
    let finished = false;

    // If an abort happens before streaming starts
    req.raw.signal.addEventListener("abort", () => {
        if (!finished) {
            abortController.abort();
            logger.error("Streaming completion aborted");
        }
    });

    const prompt = applyChatTemplate(model, promptTemplate, params);
    const generator = model.generateGen(
        prompt,
        params,
        abortController.signal,
    );

    for await (const chunk of generator) {
        stream.onAbort(() => {
            if (!finished) {
                abortController.abort();
                logger.error("Streaming completion aborted");
                finished = true;

                // Break out of the stream loop
                return;
            }
        });

        const streamChunk = await createStreamChunk(
            chunk,
            model.path.name,
            cmplId,
        );

        await stream.writeSSE({
            data: JSON.stringify(streamChunk),
        });

        // Write usage stats if user requests it
        if (params.stream_options?.include_usage && chunk.kind === "finish") {
            const usageChunk = await createUsageChunk(
                chunk,
                model.path.name,
                cmplId,
            );

            await stream.writeSSE({
                data: JSON.stringify(usageChunk),
            });
        }
    }
}

export async function generateChatCompletion(
    req: HonoRequest,
    model: Model,
    promptTemplate: PromptTemplate,
    params: ChatCompletionRequest,
) {
    const prompt = applyChatTemplate(model, promptTemplate, params);
    const gen = await staticGenerate(req, model, prompt, params);
    const response = await createResponse(gen, model.path.name);

    return response;
}

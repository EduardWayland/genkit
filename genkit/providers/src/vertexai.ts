import {
  VertexAI,
  FunctionDeclarationSchemaType,
  GenerateContentCandidate,
  FunctionDeclaration,
  Tool,
  Part as VertexPart,
  StartChatParams,
} from '@google-cloud/vertexai';
import {
  ModelAction,
  modelAction,
  MessageData,
  CandidateData,
  Part,
  ToolDefinitionSchema,
  modelRef,
} from '@google-genkit/ai/model';
import { genkitPlugin } from '@google-genkit/common/config';
import { z } from 'zod';
import { Plugin } from '@google-genkit/common/config';

export const geminiPro = modelRef({
  name: 'vertex-ai/gemini-1.0-pro',
  info: {
    label: 'Vertex AI - Gemini Pro',
    names: ['gemini-1.0-pro'],
    supports: {
      multiturn: true,
      media: false,
      tools: true,
    },
  },
});

export const geminiProVision = modelRef({
  name: 'vertex-ai/gemini-1.0-pro-vision',
  info: {
    label: 'Vertex AI - Gemini Pro Vision',
    names: ['gemini-1.0-pro-vision'],
    supports: {
      multiturn: true,
      media: true,
      tools: true,
    },
  },
});

const SUPPORTED_MODELS = {
  'gemini-1.0-pro': geminiPro,
  'gemini-1.0-pro-vision': geminiProVision,
  // 'gemini-ultra': geminiUltra,
};

function toGeminiRole(role: MessageData['role']): string {
  switch (role) {
    case 'user':
      return 'user';
    case 'model':
      return 'model';
    case 'system':
      throw new Error('system role is not supported');
    case 'tool':
      return 'function';
    default:
      return 'user';
  }
}

const toGeminiMessage = (message: MessageData): any => {
  const vertexRole = toGeminiRole(message.role);
  const vertexAiMessage: any = {
    role: vertexRole,
    parts: [],
  };

  const parts = message.content;
  parts.forEach((part) => {
    if (part.text) {
      vertexAiMessage.parts.push({ text: part.text });
    } else if (part.media) {
      vertexAiMessage.parts.push({
        file_data: {
          mime_type: part.media.contentType,
          file_uri: part.media.url,
        },
      });
    } else if (part.toolRequest) {
      vertexAiMessage.parts.push({
        functionCall: {
          name: part.toolRequest.name,
          args: part.toolRequest.input,
        },
      });
    } else if (part.toolResponse) {
      vertexAiMessage.parts.push({
        functionResponse: {
          name: part.toolResponse.name,
          response: {
            name: part.toolResponse.name,
            content: part.toolResponse.output,
          },
        },
      });
    }
  });
  return vertexAiMessage;
};

const toGeminiTool = (tool: z.infer<typeof ToolDefinitionSchema>): Tool => {
  const declaration: FunctionDeclaration = {
    name: tool.name,
    description: tool.description,
    parameters: convertSchemaProperty(tool.inputSchema),
  };
  return {
    function_declarations: [declaration],
  };
};

function fromGeminiFinishReason(
  reason: GenerateContentCandidate['finishReason']
): CandidateData['finishReason'] {
  if (!reason) return 'unknown';
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'blocked';
    case 'RECITATION':
      return 'other';
    default:
      return 'unknown';
  }
}

// Converts vertex part to genkit part
function fromGeminiPart(part: VertexPart): Part {
  if (part.text) return { text: part.text };
  if (part.functionCall) return { toolRequest: part.functionCall };
  if (part.functionResponse)
    return {
      toolResponse: {
        name: part.functionResponse.name,
        output: part.functionResponse.response,
      },
    };
  throw new Error('Only support text for the moment.');
}

function fromGeminiCandidate(
  candidate: GenerateContentCandidate
): CandidateData {
  return {
    index: candidate.index || 0, // reasonable default?
    message: {
      role: 'model',
      content: candidate.content.parts.map(fromGeminiPart),
    },
    finishReason: fromGeminiFinishReason(candidate.finishReason),
    finishMessage: candidate.finishMessage,
    custom: {
      safetyRatings: candidate.safetyRatings,
      citationMetadata: candidate.citationMetadata,
    },
  };
}

// Translate JSON schema to Vertex AI's format. Specifically, the type field needs be mapped.
// Since JSON schemas can include nested arrays/objects, we have to recursively map the type field
// in all nested fields.
const convertSchemaProperty = (property) => {
  if (property.type === 'object') {
    const nestedProperties = {};
    Object.keys(property.properties).forEach((key) => {
      nestedProperties[key] = convertSchemaProperty(property.properties[key]);
    });
    return {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: nestedProperties,
      required: property.required,
    };
  } else if (property.type === 'array') {
    return {
      type: FunctionDeclarationSchemaType.ARRAY,
      items: convertSchemaProperty(property.items),
    };
  } else {
    return {
      type: FunctionDeclarationSchemaType[property.type.toUpperCase()],
    };
  }
};

type PluginParams = { project: string; location: string };
export const vertexAI: Plugin<[PluginParams]> = genkitPlugin(
  'vertex-ai',
  (params?: PluginParams) => {
    if (!params) {
      throw Error('Params need to be defined');
    }
    return {
      models: Object.keys(SUPPORTED_MODELS).map((name) =>
        vertexModel(name, params || { project: '', location: '' })
      ),
    };
  }
);

/**
 *
 */
export function vertexModel(
  name: string,
  params: {
    project: string;
    location: string;
  }
): ModelAction {
  const modelName = `vertex-ai/${name}`;
  const vertex = new VertexAI({ ...params });
  const client = vertex.preview.getGenerativeModel({ model: name });

  if (!SUPPORTED_MODELS[name]) throw new Error(`Unsupported model: ${name}`);
  return modelAction(
    { name: modelName, ...SUPPORTED_MODELS[name].info },
    async (request) => {
      const messages = request.messages;
      if (messages.length === 0) throw new Error('No messages provided.');

      const tools = request.tools?.map(toGeminiTool) || [];
      const chatRequest: StartChatParams = {
        tools: tools,
        history: messages
          .slice(0, -1)
          .map((message) => toGeminiMessage(message)),
        generation_config: {
          candidate_count: request.candidates,
          temperature: request.config?.temperature,
          max_output_tokens: request.config?.maxOutputTokens,
          top_k: request.config?.topK,
          top_p: request.config?.topP,
          stop_sequences: request.config?.stopSequences,
        },
      };
      const msg = toGeminiMessage(messages[messages.length - 1]);
      const result = await client.startChat(chatRequest).sendMessage(msg.parts);
      if (!result.response.candidates?.length)
        throw new Error('No valid candidates returned.');
      return {
        candidates: result.response.candidates?.map(fromGeminiCandidate) || [],
        custom: result.response,
      };
    }
  );
}
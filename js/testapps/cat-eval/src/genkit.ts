/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { devLocalVectorstore } from '@genkit-ai/dev-local-vectorstore';
import { genkitEval, GenkitMetric } from '@genkit-ai/evaluator';
import { gemini15Pro, googleAI } from '@genkit-ai/googleai';
import { textEmbedding004, vertexAI } from '@genkit-ai/vertexai';
import { genkit } from 'genkit';

// Turn off safety checks for evaluation so that the LLM as an evaluator can
// respond appropriately to potentially harmful content without error.
export const PERMISSIVE_SAFETY_SETTINGS: any = {
  safetySettings: [
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_NONE',
    },
  ],
};

export const ai = genkit({
  plugins: [
    googleAI(),
    genkitEval({
      judge: gemini15Pro,
      judgeConfig: PERMISSIVE_SAFETY_SETTINGS,
      metrics: [GenkitMetric.MALICIOUSNESS],
      embedder: textEmbedding004,
    }),
    vertexAI({
      location: 'us-central1',
    }),
    devLocalVectorstore([
      {
        indexName: 'pdfQA',
        embedder: textEmbedding004,
      },
    ]),
  ],
});

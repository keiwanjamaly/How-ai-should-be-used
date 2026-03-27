/**
 * Parses a Server-Sent Events (SSE) stream from a ReadableStream.
 *
 * @param reader - The stream reader from response.body.getReader()
 * @param decoder - The TextDecoder instance for the stream
 * @param onEvent - Callback invoked for each valid SSE data line (after "data: " prefix)
 * @param signal - Optional AbortSignal to stop parsing
 * @returns Promise resolving to the complete accumulated content
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  onEvent: (data: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let buffer = "";
  let complete = "";
  let streamDone = false;

  try {
    while (!streamDone) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          break;
        }

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        // SSE protocol: ignore empty lines, comments (":"), and non-data lines
        if (!line || line.startsWith(":") || !line.startsWith("data:")) {
          continue;
        }

        const payload = line.slice(5).trim();

        if (payload === "[DONE]") {
          streamDone = true;
          break;
        }

        onEvent(payload);
        complete += payload;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return complete;
}

/**
 * Parses a single SSE data payload as JSON and returns the content field
 * for OpenAI-compatible streaming responses.
 */
export function parseOpenAIStreamChunk(payload: string): { content?: string; error?: string } {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
      error?: { message?: string };
    };

    if (parsed.error?.message) {
      return { error: parsed.error.message };
    }

    const content = parsed.choices?.[0]?.delta?.content;
    return { content };
  } catch {
    // Invalid JSON - skip this chunk
    return {};
  }
}

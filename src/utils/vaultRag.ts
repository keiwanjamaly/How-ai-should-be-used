const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "how",
  "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or", "our",
  "that", "the", "their", "them", "there", "these", "they", "this", "to", "was",
  "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

export interface IndexedChunk {
  path: string;
  title: string;
  content: string;
  normalized: string;
  tokens: string[];
}

export interface RankedChunk {
  path: string;
  title: string;
  content: string;
  score: number;
}

export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function chunkDocument(content: string, maxChunkSize: number): string[] {
  const cleaned = content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  const paragraphs = cleaned.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChunkSize) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }

      for (let start = 0; start < paragraph.length; start += maxChunkSize) {
        chunks.push(paragraph.slice(start, start + maxChunkSize).trim());
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChunkSize) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
    }
    current = paragraph;
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function rankChunks(
  chunks: IndexedChunk[],
  query: string,
  limit: number,
  activeFilePath?: string,
): RankedChunk[] {
  const queryTokens = Array.from(new Set(tokenizeText(query)));
  if (queryTokens.length === 0) {
    return [];
  }

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const chunk of chunks) {
      if (chunk.tokens.includes(token)) {
        count += 1;
      }
    }
    documentFrequency.set(token, count);
  }

  const totalChunks = Math.max(chunks.length, 1);
  return chunks
    .map((chunk) => {
      let score = 0;
      const tokenCounts = new Map<string, number>();
      for (const token of chunk.tokens) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      }

      for (const token of queryTokens) {
        const tf = tokenCounts.get(token) ?? 0;
        if (tf === 0) {
          continue;
        }

        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log((totalChunks + 1) / (df + 1)) + 1;
        score += (1 + Math.log(tf)) * idf;
      }

      if (chunk.normalized.includes(query.toLowerCase())) {
        score += 2;
      }

      if (queryTokens.some((token) => chunk.path.toLowerCase().includes(token))) {
        score += 1.5;
      }

      if (activeFilePath && chunk.path === activeFilePath) {
        score += 0.75;
      }

      return {
        path: chunk.path,
        title: chunk.title,
        content: chunk.content,
        score,
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

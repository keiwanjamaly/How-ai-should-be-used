type ChunkPathLike = { path: string };

export function getUniqueChunkPaths(chunks: ChunkPathLike[]): string[] {
  const uniquePaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const chunk of chunks) {
    const path = chunk.path.trim();
    if (!path || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    uniquePaths.push(path);
  }

  return uniquePaths;
}

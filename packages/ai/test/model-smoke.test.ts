import { describe, expect, it } from "vitest";
import { createLocalEmbedder, createLocalTagger, EMBEDDING_DIMENSIONS } from "../src/index";

const enabled = process.env.RUN_MODEL_TESTS === "1";

describe.skipIf(!enabled)("real models", () => {
  it(
    "embeds 384 dimensions with q8 bge and keeps the tag fixtures on bart fp32",
    async () => {
      const embedder = createLocalEmbedder({ dimensions: EMBEDDING_DIMENSIONS });
      const [vector] = await embedder.embed(["Node.js Lithium LTS"]);
      expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
      await embedder.dispose?.();

      const tagger = createLocalTagger();
      const nodeTags = await tagger.tag({
        text: "Node.js v26.13.0 (Lithium LTS). Node.js v26.13.0 is an LTS release.",
        source: "node",
        parserTags: ["lts", "lithium", "node"],
      });
      expect(nodeTags).not.toContain("react");
      const cssTags = await tagger.tag({
        text: "Firefox supports the CSS overflow-clip-margin property.",
        source: "caniuse",
        parserTags: ["caniuse", "css", "firefox"],
      });
      expect(cssTags).not.toContain("node");
      expect(cssTags).not.toContain("lts");
      await tagger.dispose?.();
    },
    180_000,
  );
});

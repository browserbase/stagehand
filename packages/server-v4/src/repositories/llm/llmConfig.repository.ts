import { desc, eq } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client.js";
import { llmConfigs } from "../../db/schema/index.js";
import type { LLMConfigSelect } from "../../db/schema/zod.js";

type LlmConfigInsertRow = typeof llmConfigs.$inferInsert;
type LlmConfigUpdateRow = Partial<LlmConfigInsertRow>;

export class LlmConfigRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async list(): Promise<LLMConfigSelect[]> {
    return this.db
      .select()
      .from(llmConfigs)
      .orderBy(desc(llmConfigs.createdAt), desc(llmConfigs.id));
  }

  async getById(id: string): Promise<LLMConfigSelect | null> {
    const [llm] = await this.db
      .select()
      .from(llmConfigs)
      .where(eq(llmConfigs.id, id))
      .limit(1);

    return llm ?? null;
  }

  async create(values: LlmConfigInsertRow): Promise<LLMConfigSelect> {
    const [llm] = await this.db.insert(llmConfigs).values(values).returning();

    return llm;
  }

  async updateById(
    id: string,
    values: LlmConfigUpdateRow,
  ): Promise<LLMConfigSelect | null> {
    const [llm] = await this.db
      .update(llmConfigs)
      .set(values)
      .where(eq(llmConfigs.id, id))
      .returning();

    return llm ?? null;
  }
}

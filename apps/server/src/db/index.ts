import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url: string) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Migrationen liegen in ./drizzle und werden beim Start eingespielt. */
export async function runMigrations(db: Db, folder: string) {
  await migrate(db, { migrationsFolder: folder });
}

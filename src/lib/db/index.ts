import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema>;

function createDb(): Database {
  const url = process.env.DATABASE_URL!;
  const isNeon = url.includes("neon.tech") || url.includes("neon.db");

  if (isNeon) {
    return drizzleNeon({ client: neon(url), schema });
  }

  // Standard pg driver — for local Docker Postgres, Supabase, etc.
  const { Pool } = require("pg") as typeof import("pg");
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Database;
}

export const db = createDb();

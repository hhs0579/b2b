import { env } from "./env.js";

export const databaseConfig = {
  host: env.database.host,
  port: env.database.port,
  database: env.database.database,
  user: env.database.user,
  password: env.database.password,
  max: 10,
  connectionTimeoutMillis: 5000,
  options: "-c timezone=Asia/Seoul",
};

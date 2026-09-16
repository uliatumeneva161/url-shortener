import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Во время тестов база данных другая — рабочую shortlink не трогаем.
    env: {
      PGDATABASE: "url_shortener_test",
    },
    include: ["test/**/*.test.ts"],
  },
});
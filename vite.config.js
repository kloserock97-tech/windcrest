import { defineConfig } from "vite";

/* Relative paths, so the build also works from a project page such as
   https://<user>.github.io/driftfield/ and not only from a domain root. */
export default defineConfig({
    base: "./",
    build: { target: "es2022" },
});

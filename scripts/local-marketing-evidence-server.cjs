process.env.API_INTERNAL_URL = "http://127.0.0.1:4010";
process.argv = [process.execPath, "next", "dev", "-p", "3100"];
process.chdir(require("node:path").resolve(__dirname, "../apps/marketing-web"));
require("../apps/marketing-web/node_modules/next/dist/bin/next");

const http = require("node:http");

const terms = [
  ["starter", "monthly", "2900"],
  ["starter", "quarterly", "8265"],
  ["starter", "yearly", "27840"],
  ["growth", "monthly", "7900"],
  ["growth", "quarterly", "22515"],
  ["growth", "yearly", "75840"],
  ["scale", "monthly", "12900"],
  ["scale", "quarterly", "36765"],
  ["scale", "yearly", "123840"],
].map(([plan, cadence, amountMinor]) => ({ plan, cadence, amountMinor, currency: "USD" }));

http
  .createServer((request, response) => {
    if (request.url !== "/v1/public/pricing") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: { market: { code: "GLOBAL", country: null, currency: "USD" }, terms },
      }),
    );
  })
  .listen(4010, "127.0.0.1");

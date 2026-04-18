import { Buffer } from "node:buffer";
import { expect, test as base } from "@playwright/test";

type RuntimeMonitor = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
};

export const test = base.extend<{ runtime: RuntimeMonitor }>({
  runtime: async ({ page }, use, testInfo) => {
    const runtime: RuntimeMonitor = {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    };

    page.on("console", (message) => {
      if (message.type() === "error") {
        runtime.consoleErrors.push(message.text());
      }
    });

    page.on("pageerror", (error) => {
      runtime.pageErrors.push(error.message);
    });

    page.on("requestfailed", (request) => {
      const failure = request.failure();
      runtime.requestFailures.push(
        `${request.method()} ${request.url()}${failure?.errorText ? ` - ${failure.errorText}` : ""}`,
      );
    });

    await use(runtime);

    await testInfo.attach("runtime-monitor.json", {
      body: Buffer.from(JSON.stringify(runtime, null, 2)),
      contentType: "application/json",
    });

    expect.soft(runtime.pageErrors, "Unexpected uncaught browser errors").toEqual([]);
  },
});

export { expect };

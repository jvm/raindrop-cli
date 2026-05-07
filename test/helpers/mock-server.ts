import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export type MockRoute = {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  once?: boolean;
};

export type MockServer = {
  url: string;
  server: Server;
  routes: MockRoute[];
  requests: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }[];
  addRoute(route: MockRoute): void;
  close(): Promise<void>;
};

export async function createMockServer(): Promise<MockServer> {
  const routes: MockRoute[] = [];
  const requests: MockServer["requests"] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let parsedBody: unknown;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
      } catch {
        parsedBody = bodyText;
      }

      const reqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") reqHeaders[k] = v;
        else if (Array.isArray(v)) reqHeaders[k] = v.join(", ");
      }

      requests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: reqHeaders,
        body: parsedBody,
      });

      const routeIndex = routes.findIndex(
        (r) => r.method === req.method && req.url?.startsWith(r.path),
      );

      if (routeIndex !== -1) {
        const route = routes[routeIndex]!;
        if (route.once) routes.splice(routeIndex, 1);
        const status = route.status ?? 200;
        const resHeaders = {
          "Content-Type": "application/json",
          ...route.headers,
        };
        res.writeHead(status, resHeaders);
        res.end(
          route.body !== undefined
            ? JSON.stringify(route.body)
            : '{"result":true}',
        );
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"result":false,"error":"mock route not found"}');
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string")
        return reject(new Error("failed to get server address"));
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        server,
        routes,
        requests,
        addRoute(route: MockRoute) {
          routes.push(route);
        },
        close() {
          return new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          );
        },
      });
    });
  });
}

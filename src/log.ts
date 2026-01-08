import {
  neon,
  SimplePrettyTerminalTransport,
} from "@loglayer/transport-simple-pretty-terminal";
import { ConsoleTransport, type ILogLayer, LogLayer } from "loglayer";
import { serializeError } from "serialize-error";
import { createContext } from "./context";

const isDevelopment = process.env.NODE_ENV !== "production";

const baseLoggerInstance = new LogLayer({
  errorSerializer: serializeError,
  transport: isDevelopment
    ? [
        new SimplePrettyTerminalTransport({
          runtime: "node",
          theme: neon,
        }),
      ]
    : [
        new ConsoleTransport({
          logger: console,
        }),
      ],
});

const baseLogger = baseLoggerInstance;

const LogContext = createContext<ILogLayer>("log");

export function withLog<R>(metadata: Record<string, unknown>, fn: () => R) {
  const currentLogger = LogContext.useSafe() ?? baseLogger;
  const child = currentLogger.child().withContext(metadata);
  return LogContext.with(child, fn);
}

export const log = new Proxy(baseLogger, {
  get(target, prop) {
    const loggerToUse = LogContext.useSafe() ?? target;
    return loggerToUse[prop as keyof ILogLayer];
  },
});

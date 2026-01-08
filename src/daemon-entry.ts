#!/usr/bin/env bun
// Daemon entry point - this file is spawned as a detached process
process.env.AGENT_BROWSER_DAEMON = "1";
import "./daemon";

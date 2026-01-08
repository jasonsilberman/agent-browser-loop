import { defineBrowserConfig } from "agent-browser-loop";

// Example config - auto-discovered when running agent-browser start in this directory
export default defineBrowserConfig({
  headless: false,
  viewportWidth: 1440,
  viewportHeight: 900,
});

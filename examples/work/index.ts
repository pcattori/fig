import { plugins } from "fig:plugins";

const { json, text } = plugins(import.meta.url);

export default [
  json("~/.config/demo/settings.json", (config) => {
    config.theme = "dark";
    config.extensions.push("work-tools");
  }),
  text("~/.demo-notes", (contents) => contents.replace("base config", "work config")),
];

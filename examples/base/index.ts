import { plugins } from "fig:plugins";

const { files } = plugins(import.meta.url);

export default [files("./home")];

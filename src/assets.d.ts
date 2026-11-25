// Files imported `with { type: "file" }` resolve to a path the server can read.
declare module "*.woff2" {
  const path: string;
  export default path;
}

declare module "*.png" {
  const path: string;
  export default path;
}

declare module "*.ico" {
  const path: string;
  export default path;
}

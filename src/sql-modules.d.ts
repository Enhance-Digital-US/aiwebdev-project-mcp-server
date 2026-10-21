// Wrangler bundles *.sql files as Text modules (default module rules).
declare module '*.sql' {
  const sql: string;
  export default sql;
}

declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}

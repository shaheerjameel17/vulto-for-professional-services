/**
 * @vulto/schema — the graph schema, shared types and Zod validators.
 *
 * PLACEHOLDER. This package is created empty and buildable by FDN-47, which
 * owns repository structure and nothing else.
 *
 * Its content is VPS-A002's node and edge registry, and it arrives with
 * FDN-45. Nothing may be added here before then: A002-T09 makes registration
 * precede implementation, and VPS-A007's third gate fails a type in this
 * package with no row in VPS-A002's registry.
 */

/**
 * The schema package's version of the graph contract it will expose.
 *
 * Present so the package has a compiled export and an importable surface. It
 * carries no meaning yet and is not a schema version — VPS-A002's
 * `schema_version` is per node type and is registered with the node.
 */
export const SCHEMA_PACKAGE_PLACEHOLDER = true;

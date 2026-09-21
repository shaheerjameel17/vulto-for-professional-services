import { open } from "./aes.js";
import {
  decodeContent,
  FragmentAuthenticationError,
  fragmentAad,
  type FragmentHeader,
} from "./envelope.js";

/**
 * The one field-decryption primitive (A003-T59, A007-T08). It is importable
 * only from `protected/read.ts`, `jobs/principal.ts` and `protected/erasure.ts`,
 * each of which writes an audit entry first; `pnpm arch:check` fails the build
 * otherwise. The header is rebuilt by the caller from the row's own columns, so
 * ciphertext moved to another owner, partition, key or workspace fails here.
 */
export function decryptFragment(
  dataKey: Uint8Array,
  fragment: { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array },
  header: FragmentHeader,
): unknown {
  try {
    return decodeContent(
      open(dataKey, fragment.nonce, fragment.ciphertext, fragmentAad(header)),
    );
  } catch {
    throw new FragmentAuthenticationError();
  }
}

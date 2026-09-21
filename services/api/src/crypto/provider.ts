import { AwsKmsKeyProvider } from "./aws-kms-key-provider.js";
import type { KeyProvider } from "./key-provider.js";
import { LocalKeyProvider } from "./local-key-provider.js";

export interface KeyProviderConfig {
  readonly provider: string | undefined;
  readonly nodeEnv: string | undefined;
  readonly localRootKey: string | undefined;
  readonly awsRegion: string | undefined;
  readonly kmsRootKeyArn: string | undefined;
}

export function keyProviderConfigFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): KeyProviderConfig {
  return {
    provider: source["VULTO_KEY_PROVIDER"],
    nodeEnv: source["NODE_ENV"],
    localRootKey: source["VULTO_LOCAL_ROOT_KEY"],
    awsRegion: source["AWS_REGION"],
    kmsRootKeyArn: source["VULTO_KMS_ROOT_KEY_ARN"],
  };
}

/**
 * Selects the key provider by `VULTO_KEY_PROVIDER`. It throws — at startup,
 * because the server builds one before it listens — if production is asked to
 * use the local provider (A003-T73).
 */
export function createKeyProvider(config: KeyProviderConfig): KeyProvider {
  const provider =
    config.provider === undefined || config.provider === "" ? "local" : config.provider;
  if (provider === "local") {
    if (config.nodeEnv === "production") {
      throw new Error("VULTO_KEY_PROVIDER=local is refused in production; use aws-kms");
    }
    if (!config.localRootKey)
      throw new Error("VULTO_LOCAL_ROOT_KEY is required for the local key provider");
    return new LocalKeyProvider(config.localRootKey);
  }
  if (provider === "aws-kms") {
    return new AwsKmsKeyProvider({
      keyId: config.kmsRootKeyArn ?? "",
      ...(config.awsRegion ? { region: config.awsRegion } : {}),
    });
  }
  throw new Error(`Unknown VULTO_KEY_PROVIDER: ${provider}`);
}

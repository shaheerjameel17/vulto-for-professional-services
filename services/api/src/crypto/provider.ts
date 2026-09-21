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
 * Selects the key provider by `VULTO_KEY_PROVIDER`. There is no default: an unset
 * or empty value is an error in every environment, so a server that lost its
 * configuration cannot fall back to a development key. `local` is accepted only
 * when `NODE_ENV` is `development` or `test` — not merely "not production" — so
 * a production server missing `NODE_ENV` refuses it too (A003-T73). The server
 * builds a provider before it listens, so this fails at startup.
 */
export function createKeyProvider(config: KeyProviderConfig): KeyProvider {
  const provider = config.provider;
  if (provider === undefined || provider === "") {
    throw new Error(
      "VULTO_KEY_PROVIDER is not set; choose aws-kms, or local for development and test",
    );
  }
  if (provider === "local") {
    if (config.nodeEnv !== "development" && config.nodeEnv !== "test") {
      throw new Error(
        "VULTO_KEY_PROVIDER=local is accepted only when NODE_ENV is development or test",
      );
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

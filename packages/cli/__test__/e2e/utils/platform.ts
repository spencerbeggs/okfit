import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import type { Digest } from "effect/crypto";

/**
 * The live Node platform the engine suites run on: `NodeServices.layer` plus
 * `NodeCrypto.layerDigest`. Since Effect 4.1 `NodeServices` carries no crypto,
 * and every body and content digest needs core's `Digest`.
 */
export const TestPlatform: Layer.Layer<TestServices> = Layer.mergeAll(NodeServices.layer, NodeCrypto.layerDigest);

/** The services {@link TestPlatform} provides. */
export type TestServices = NodeServices.NodeServices | Digest.Digest;

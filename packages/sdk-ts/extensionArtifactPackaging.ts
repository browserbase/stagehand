export function assertPublicExtensionArtifact(metadata: unknown): void {
  const configured =
    typeof metadata === "object" && metadata !== null && "residentTransportConfigured" in metadata
      ? metadata.residentTransportConfigured
      : undefined;
  if (configured !== false) {
    throw new Error("Refusing to package a privately configured resident extension in the SDK");
  }
}

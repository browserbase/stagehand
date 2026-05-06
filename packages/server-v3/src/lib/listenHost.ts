export const DEFAULT_LISTEN_HOST = "localhost";
export const ALL_INTERFACES_LISTEN_HOST = "0.0.0.0";

const allInterfacesWarning =
  "HOST=0.0.0.0 was passed explicitly, so the Stagehand server will listen on all network interfaces. Use HOST=localhost or HOST=127.0.0.1 unless you intend to expose this server beyond the local machine.";

export type ListenHostConfig = {
  host: string;
  warning?: string;
};

export const getListenHostConfig = (
  hostEnv = process.env.HOST,
): ListenHostConfig => {
  const host = hostEnv?.trim() || DEFAULT_LISTEN_HOST;

  if (host === ALL_INTERFACES_LISTEN_HOST) {
    return {
      host,
      warning: allInterfacesWarning,
    };
  }

  return { host };
};

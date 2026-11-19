import * as React from "react";
import { Button } from "./Button";

type Feature = "gmail" | "calendar" | "driveFile";

type Props = {
  feature: Feature | Feature[];
};

export function ConnectGoogleButton({ feature }: Props) {
  const [status, setStatus] = React.useState('');
  const openFlow = () => {
    const popup = window.open("about:blank", "google_integrations", "width=480,height=720");
    if (!popup) { setStatus('Permite ventanas emergentes para conectar Gmail.'); return; }

    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      const data = event.data;
      if (data?.type === "GOOGLE_INTEGRATION_SUCCESS") {
        setStatus(data.email === "tarsi.studiomx@gmail.com" ? "Gmail de TARSI conectado." : "Selecciona la cuenta tarsi.studiomx@gmail.com.");
        window.removeEventListener("message", listener);
      } else if (data?.type === "GOOGLE_INTEGRATION_ERROR") {
        setStatus("No se pudo conectar Gmail.");
        window.removeEventListener("message", listener);
      }
    };
    window.addEventListener("message", listener);

    const features = Array.isArray(feature) ? feature : [feature];
    fetch(`/_api/auth/google_integrations_authorize?feature=${encodeURIComponent(features.join(","))}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.authorize_url) throw new Error("start_failed");
        popup.location.href = data.authorize_url;
      })
      .catch(() => {
        window.removeEventListener("message", listener);
        popup.close();
        setStatus("No se pudo abrir la conexión con Google.");
      });
  };

  return (
    <><Button type="button" onClick={openFlow}>
      Conectar Gmail
    </Button><p role="status">{status}</p></>
  );
}
